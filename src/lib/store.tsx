/**
 * 应用状态管理
 *
 * 用一个 Context 统一管理状态，所有写入都通过 mutator 串行执行，
 * 避免「前台手动检查」和「后台定时任务」同时写存储造成互相覆盖。
 */
import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
// 别名导入：本项目自己也有一个数据类型叫 AppState（应用持久化状态），
// 不能和 React Native 的 AppState（前后台状态）重名。
import { AppState as RNAppState } from 'react-native';

import { normalizeOrgInput, siteLabel } from '../core/url.mjs';
import { resolveStableOrgId } from '../core/search.mjs';
import {
  loadState, saveState, clearState, makeWatch,
  addWatch as addWatchOp, removeWatch as removeWatchOp, updateWatch as updateWatchOp,
  updateSettings as updateSettingsOp, pushNotifications, markAllRead, clearNotifications,
  pushSearchHistory, removeSearchHistory, clearSearchHistory,
} from './storage';
import type { AppState, WatchItem, StoredNotification } from './types';
import { EMPTY_STATE, DEFAULT_SETTINGS, makeWatchKey } from './types';
import { runCheck } from './checker';
import {
  configureNotificationHandler, requestNotificationPermission, presentLocalNotification,
} from './notifications';
import {
  registerBackgroundTask, unregisterBackgroundTask, getBackgroundStatus, clampInterval,
} from './backgroundTask';
import type { BackgroundStatus } from './backgroundTask';
import { sendNewProjectsMail, mailConfigFromSettings } from './email';

/** 模块加载时就设置好前台通知展示行为 */
configureNotificationHandler();

export interface StoreValue {
  ready: boolean;
  state: AppState;
  /** 是否正在检查 */
  checking: boolean;
  /** 上次检查的汇总提示 */
  lastRunMessage: string;

  addWatchFromUrl: (
    input: string,
    alias?: string
  ) => Promise<{ key: string; name: string; firstResult?: string }>;
  /** 从搜索结果添加：内部会把加密链接 id 换成稳定的数字团号 */
  addWatchFromSearchResult: (
    host: string,
    linkId: string,
    fallbackName: string
  ) => Promise<{ key: string; name: string; firstResult?: string }>;
  /** 记一条搜索历史 */
  recordSearch: (keyword: string) => Promise<void>;
  removeSearchHistoryItem: (keyword: string) => Promise<void>;
  clearSearchHistoryAll: () => Promise<void>;
  removeWatch: (key: string) => Promise<void>;
  setWatchEnabled: (key: string, enabled: boolean) => Promise<void>;
  renameWatch: (key: string, alias: string) => Promise<void>;
  checkAll: () => Promise<void>;
  checkOneWatch: (key: string) => Promise<void>;
  updateSettings: (patch: Partial<AppState['settings']>) => Promise<void>;
  markAllNotificationsRead: () => Promise<void>;
  clearAllNotifications: () => Promise<void>;
  resetAll: () => Promise<void>;
  /** 后台任务状态，用于设置页展示 */
  bg: BackgroundStatus;
  refreshBgStatus: () => Promise<void>;
}

const StoreContext = createContext<StoreValue | null>(null);

export function useStore(): StoreValue {
  const v = useContext(StoreContext);
  if (!v) throw new Error('useStore 必须在 StoreProvider 内使用');
  return v;
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AppState>(() => ({ ...EMPTY_STATE }));
  const [ready, setReady] = useState(false);
  const [checking, setChecking] = useState(false);
  const [lastRunMessage, setLastRunMessage] = useState('');
  const [bg, setBg] = useState<BackgroundStatus>({
    availability: 'unknown', registered: false,
  });

  /** 用 ref 保存最新状态，供串行 mutator 读取 */
  const stateRef = useRef(state);
  // 渲染期间不能写 ref（React 新规则会报错），改在 effect 里同步。
  // persist() 内部也会同步写一次，所以写队列里读到的一定是最新值。
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  /**
   * 写操作串行队列，防止并发覆盖。
   *
   * ⚠️ 必须带超时保护：
   * iOS 把 App 切到后台时会冻结 JS 定时器。若某次 fetch 卡住，它自身的
   * AbortController 定时器也不会触发，这个 Promise 就永远不结算，
   * 队列被永久堵死 —— 之后每次「立即检查」都只是排在它后面，界面毫无反应。
   * 加一层 Promise.race 超时，保证队列一定能继续往前走。
   */
  const queueRef = useRef<Promise<unknown>>(Promise.resolve());
  const enqueue = useCallback(<T,>(fn: () => Promise<T>, timeoutMs = 45000): Promise<T> => {
    const guarded = () =>
      Promise.race<T>([
        fn(),
        new Promise<T>((_, reject) =>
          setTimeout(() => reject(new Error('操作超时（超过 45 秒）')), timeoutMs)
        ),
      ]);
    const next = queueRef.current.then(guarded, guarded);
    // 保证队列不会因为某次失败而中断
    queueRef.current = next.catch(() => undefined);
    return next;
  }, []);

  const persist = useCallback(
    async (mutator: (s: AppState) => AppState): Promise<AppState> => {
      const next = mutator(stateRef.current);
      stateRef.current = next;
      setState(next);
      await saveState(next);
      return next;
    },
    []
  );

  /* ------------------------------------------------------------ 初始化 */

  useEffect(() => {
    let alive = true;
    (async () => {
      const loaded = await loadState();
      if (!alive) return;
      stateRef.current = loaded;
      setState(loaded);
      setReady(true);

      // 有启用的监控时，按设置注册后台任务
      try {
        if (loaded.settings.backgroundCheckEnabled && loaded.watches.some((w) => w.enabled)) {
          await registerBackgroundTask(loaded.settings.intervalMinutes);
        }
        const fresh = await getBackgroundStatus();
        if (alive) setBg(fresh);
      } catch (e) {
        console.warn('[store] 初始化后台任务失败', e);
      }
    })();
    return () => { alive = false; };
  }, []);

  /* ------------------------------------------------------------ 操作 */

  const refreshBgStatus = useCallback(async () => {
    const s = await getBackgroundStatus();
    setBg(s);
  }, []);

  const addWatchFromUrl = useCallback(
    async (input: string, alias?: string) => {
      const target = normalizeOrgInput(input); // 非法输入会在这里抛错，交给 UI 显示
      const key = makeWatchKey(target.host, target.id);
      return enqueue(async () => {
        const current = stateRef.current;
        // 按 key 判重：同 id 不同站点是两个不同团体
        if (current.watches.some((w) => w.key === key)) {
          throw new Error(`这个团体已经在监控列表里了（${target.host}）`);
        }
        const watch = makeWatch({ id: target.id, host: target.host, url: target.url });
        if (alias) watch.alias = alias;

        await persist((s) => addWatchOp(s, watch));

        // 首次立刻抓一次，顺便把团体名和已有项目登记为「已知」，
        // 这样不会一添加就误报一堆「新项目」
        try {
          const result = await runCheck([watch], false);
          const updated = result.watches[0];
          await persist((s) => updateWatchOp(s, watch.key, updated));
          await registerBackgroundTask(stateRef.current.settings.intervalMinutes);
          void refreshBgStatus();
          return { key: watch.key, name: updated.name, firstResult: updated.lastResult };
        } catch (e) {
          // 抓取失败不影响添加成功，但要把原因带回去让 UI 提示用户
          const reason = (e as Error).message;
          await persist((s) => updateWatchOp(s, watch.key, { lastResult: `检查失败：${reason}` }));
          return { key: watch.key, name: watch.name, firstResult: `检查失败：${reason}` };
        }
      });
    },
    [enqueue, persist, refreshBgStatus]
  );

  /**
   * 从搜索结果添加团体。
   *
   * 搜索页给的链接 id 是服务端加密的（每次请求都变），所以这里先把它
   * 换成页面里的「数字团号」（数据库主键，长期稳定）再保存。
   */
  const addWatchFromSearchResult = useCallback(
    async (host: string, linkId: string, fallbackName: string) => {
      // 解析放在队列外：这是纯网络请求，不需要占用写队列
      const stable = await resolveStableOrgId(host, linkId);
      const id = stable.stableId || linkId;
      const key = makeWatchKey(host, id);

      return enqueue(async () => {
        if (stateRef.current.watches.some((w) => w.key === key)) {
          throw new Error(`「${fallbackName}」已经在监控列表里了`);
        }
        const watch = makeWatch({ id, host, url: stable.url });
        await persist((s) => addWatchOp(s, watch));

        try {
          const result = await runCheck([watch], false);
          const updated = result.watches[0];
          await persist((s) => updateWatchOp(s, watch.key, updated));
          await registerBackgroundTask(stateRef.current.settings.intervalMinutes);
          void refreshBgStatus();
          return {
            key: watch.key,
            name: updated.name || fallbackName,
            firstResult: updated.lastResult,
          };
        } catch (e) {
          const reason = (e as Error).message;
          await persist((s) => updateWatchOp(s, watch.key, { lastResult: `检查失败：${reason}` }));
          return {
            key: watch.key,
            name: fallbackName,
            firstResult: `检查失败：${reason}`,
          };
        }
      });
    },
    [enqueue, persist, refreshBgStatus]
  );

  /* ------------------------------------------------ 搜索历史 */

  const recordSearch = useCallback(
    async (keyword: string) => {
      await enqueue(async () => { await persist((s) => pushSearchHistory(s, keyword)); });
    },
    [enqueue, persist]
  );

  const removeSearchHistoryItem = useCallback(
    async (keyword: string) => {
      await enqueue(async () => { await persist((s) => removeSearchHistory(s, keyword)); });
    },
    [enqueue, persist]
  );

  const clearSearchHistoryAll = useCallback(
    async () => {
      await enqueue(async () => { await persist(clearSearchHistory); });
    },
    [enqueue, persist]
  );

  const removeWatch = useCallback(
    async (key: string) => {
      await enqueue(async () => {
        await persist((s) => removeWatchOp(s, key));
        const rest = stateRef.current.watches.filter((w) => w.enabled);
        if (rest.length === 0) {
          await unregisterBackgroundTask().catch(() => undefined);
        }
        void refreshBgStatus();
      });
    },
    [enqueue, persist, refreshBgStatus]
  );

  const setWatchEnabled = useCallback(
    async (key: string, enabled: boolean) => {
      await enqueue(async () => {
        await persist((s) => updateWatchOp(s, key, { enabled }));
        const active = stateRef.current.watches.filter((w) => w.enabled);
        if (active.length > 0 && stateRef.current.settings.backgroundCheckEnabled) {
          await registerBackgroundTask(stateRef.current.settings.intervalMinutes).catch(() => undefined);
        } else if (active.length === 0) {
          await unregisterBackgroundTask().catch(() => undefined);
        }
        void refreshBgStatus();
      });
    },
    [enqueue, persist, refreshBgStatus]
  );

  const renameWatch = useCallback(
    async (key: string, alias: string) => {
      await enqueue(async () => {
        await persist((s) => updateWatchOp(s, key, { alias }));
      });
    },
    [enqueue, persist]
  );

  /** 把一次检查结果应用到状态，并发送通知 */
  const applyCheckResult = useCallback(
    async (
      result: Awaited<ReturnType<typeof runCheck>>,
      opts: { notify: boolean }
    ) => {
      const settings = stateRef.current.settings;

      const newNotifs: StoredNotification[] = result.items
        .filter((it) => it.ok && it.newItems.length > 0)
        .map((it) => ({
          id: `${it.orgId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          orgId: it.orgId,
          orgName: it.orgName,
          title: it.title,
          body: it.body,
          oppIds: it.newItems.map((n) => n.id),
          createdAt: new Date().toISOString(),
          read: false,
        }));

      await persist((s) => {
        let next = { ...s, watches: result.watches };
        next = pushNotifications(next, newNotifs);
        return next;
      });

      // 弹本地通知
      if (opts.notify && settings.notificationsEnabled && newNotifs.length > 0) {
        const granted = await requestNotificationPermission();
        if (granted) {
          for (const n of newNotifs) {
            await presentLocalNotification(n.title, n.body, { orgId: n.orgId });
          }
        }
      }

      // 邮箱通知（默认关闭；未配置时 sendMail 会返回可读的失败原因）
      if (settings.emailEnabled && settings.emailTo) {
        const mailCfg = mailConfigFromSettings(settings);
        for (const it of result.items) {
          if (it.ok && it.newItems.length > 0) {
            const r = await sendNewProjectsMail(mailCfg, it.orgName, it.newItems, settings.emailTo);
            if (!r.ok) {
              console.warn('[email] 发送失败：', r.reason);
            }
          }
        }
      }
    },
    [persist]
  );

  const checkAll = useCallback(async () => {
    if (checking) return;
    setChecking(true);
    setLastRunMessage('');
    try {
      const result = await enqueue(() => runCheck(stateRef.current.watches, true));
      await applyCheckResult(result, { notify: true });

      const failed = result.items.filter((it) => !it.ok).length;
      const parts: string[] = [];
      parts.push(result.totalNew > 0 ? `发现 ${result.totalNew} 个新项目` : '没有新项目');
      if (failed > 0) parts.push(`${failed} 个团体检查失败`);
      setLastRunMessage(parts.join('，'));
    } catch (e) {
      setLastRunMessage(`检查出错：${(e as Error).message}`);
    } finally {
      setChecking(false);
    }
  }, [checking, enqueue, applyCheckResult]);

  const checkOneWatch = useCallback(
    async (key: string) => {
      const watch = stateRef.current.watches.find((w) => w.key === key);
      if (!watch) return;
      setChecking(true);
      try {
        const result = await enqueue(() => runCheck([watch], false));
        await applyCheckResult(result, { notify: true });
        setLastRunMessage(
          result.totalNew > 0 ? `${watch.name}：发现 ${result.totalNew} 个新项目` : `${watch.name}：没有新项目`
        );
      } catch (e) {
        setLastRunMessage(`检查出错：${(e as Error).message}`);
      } finally {
        setChecking(false);
      }
    },
    [enqueue, applyCheckResult]
  );

  const updateSettings = useCallback(
    async (patch: Partial<AppState['settings']>) => {
      await enqueue(async () => {
        await persist((s) => updateSettingsOp(s, patch));
        const s = stateRef.current;

        // 间隔变化或开关变化时重新注册
        if (s.settings.backgroundCheckEnabled && s.watches.some((w) => w.enabled)) {
          await registerBackgroundTask(clampInterval(s.settings.intervalMinutes)).catch(() => undefined);
        } else {
          await unregisterBackgroundTask().catch(() => undefined);
        }
        void refreshBgStatus();
      });
    },
    [enqueue, persist, refreshBgStatus]
  );

  const markAllNotificationsRead = useCallback(async () => {
    await enqueue(async () => { await persist(markAllRead); });
  }, [enqueue, persist]);

  const clearAllNotifications = useCallback(async () => {
    await enqueue(async () => { await persist(clearNotifications); });
  }, [enqueue, persist]);

  const resetAll = useCallback(async () => {
    await enqueue(async () => {
      await unregisterBackgroundTask().catch(() => undefined);
      await clearState();
      stateRef.current = { ...EMPTY_STATE, settings: { ...DEFAULT_SETTINGS } };
      setState(stateRef.current);
      void refreshBgStatus();
    });
  }, [enqueue, refreshBgStatus]);

  /* ------------------------------------------------ 前台定时自动检查 */

  /**
   * 用 ref 持有最新的 checkAll，避免把它放进 effect 依赖里导致
   * 定时器被反复销毁重建（checkAll 依赖 checking，每次检查都会变）。
   */
  const checkAllRef = useRef(checkAll);
  // 同样不能在渲染期写 ref，放到 effect 里
  useEffect(() => {
    checkAllRef.current = checkAll;
  }, [checkAll]);

  /** 有启用的监控项时才需要定时检查（用数量当依赖，避免整个数组变化就重建） */
  const enabledCount = state.watches.filter((w) => w.enabled).length;
  const { backgroundCheckEnabled, intervalMinutes } = state.settings;

  useEffect(() => {
    if (!ready) return;
    if (!backgroundCheckEnabled) return;
    if (enabledCount === 0) return;

    // 前台轮询间隔：至少 1 分钟，按用户设置走
    const periodMs = Math.max(1, Math.round(intervalMinutes)) * 60 * 1000;

    /** 只在 App 处于前台时才检查，避免后台无意义地跑 */
    const isActive = () => RNAppState.currentState === 'active';

    const timer = setInterval(() => {
      if (isActive()) {
        void checkAllRef.current();
      }
    }, periodMs);

    // 从后台切回前台时立刻检查一次（iOS 会冻结后台定时器，等定时器不可靠）
    const sub = RNAppState.addEventListener('change', (next) => {
      if (next === 'active') {
        void checkAllRef.current();
      }
    });

    console.log(`[auto] 前台自动检查已开启，间隔 ${intervalMinutes} 分钟`);

    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [ready, backgroundCheckEnabled, intervalMinutes, enabledCount]);

  const value = useMemo<StoreValue>(
    () => ({
      ready, state, checking, lastRunMessage, bg,
      addWatchFromUrl, addWatchFromSearchResult,
      recordSearch, removeSearchHistoryItem, clearSearchHistoryAll,
      removeWatch, setWatchEnabled, renameWatch,
      checkAll, checkOneWatch, updateSettings,
      markAllNotificationsRead, clearAllNotifications, resetAll,
      refreshBgStatus,
    }),
    [
      ready, state, checking, lastRunMessage, bg,
      addWatchFromUrl, addWatchFromSearchResult,
      recordSearch, removeSearchHistoryItem, clearSearchHistoryAll,
      removeWatch, setWatchEnabled, renameWatch,
      checkAll, checkOneWatch, updateSettings,
      markAllNotificationsRead, clearAllNotifications, resetAll, refreshBgStatus,
    ]
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

/** 便捷：拿某个监控对象的展示名 */
export function displayName(w: WatchItem): string {
  return w.alias?.trim() || w.name || w.id;
}

export { siteLabel };
