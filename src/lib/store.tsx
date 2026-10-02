/**
 * 应用状态管理
 *
 * 用一个 Context 统一管理状态，所有写入都通过 mutator 串行执行，
 * 避免「前台手动检查」和「后台定时任务」同时写存储造成互相覆盖。
 */
import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';

import { normalizeOrgInput, siteLabel } from '../core/url.mjs';
import {
  loadState, saveState, clearState, makeWatch,
  addWatch as addWatchOp, removeWatch as removeWatchOp, updateWatch as updateWatchOp,
  updateSettings as updateSettingsOp, pushNotifications, markAllRead, clearNotifications,
} from './storage';
import type { AppState, WatchItem, StoredNotification } from './types';
import { EMPTY_STATE, DEFAULT_SETTINGS } from './types';
import { runCheck } from './checker';
import {
  configureNotificationHandler, requestNotificationPermission, presentLocalNotification,
} from './notifications';
import {
  registerBackgroundTask, unregisterBackgroundTask, getBackgroundStatus, clampInterval,
} from './backgroundTask';
import type { BackgroundStatus } from './backgroundTask';
import { sendNewProjectsMail } from './email';

/** 模块加载时就设置好前台通知展示行为 */
configureNotificationHandler();

export interface StoreValue {
  ready: boolean;
  state: AppState;
  /** 是否正在检查 */
  checking: boolean;
  /** 上次检查的汇总提示 */
  lastRunMessage: string;

  addWatchFromUrl: (input: string, alias?: string) => Promise<{ id: string; name: string }>;
  removeWatch: (id: string) => Promise<void>;
  setWatchEnabled: (id: string, enabled: boolean) => Promise<void>;
  renameWatch: (id: string, alias: string) => Promise<void>;
  checkAll: () => Promise<void>;
  checkOneWatch: (id: string) => Promise<void>;
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
  stateRef.current = state;

  /** 写操作串行队列，防止并发覆盖 */
  const queueRef = useRef<Promise<unknown>>(Promise.resolve());
  const enqueue = useCallback(<T,>(fn: () => Promise<T>): Promise<T> => {
    const next = queueRef.current.then(fn, fn);
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
      return enqueue(async () => {
        const current = stateRef.current;
        if (current.watches.some((w) => w.id === target.id)) {
          throw new Error('这个团体已经在监控列表里了');
        }
        const watch = makeWatch({ id: target.id, host: target.host, url: target.url });
        if (alias) watch.alias = alias;

        await persist((s) => addWatchOp(s, watch));

        // 首次立刻抓一次，顺便把团体名和已有项目登记为「已知」，
        // 这样不会一添加就误报一堆「新项目」
        try {
          const result = await runCheck([watch], false);
          const updated = result.watches[0];
          await persist((s) => updateWatchOp(s, watch.id, updated));
          await registerBackgroundTask(stateRef.current.settings.intervalMinutes);
          void refreshBgStatus();
          return { id: watch.id, name: updated.name };
        } catch {
          // 抓取失败不影响添加成功
          return { id: watch.id, name: watch.name };
        }
      });
    },
    [enqueue, persist, refreshBgStatus]
  );

  const removeWatch = useCallback(
    async (id: string) => {
      await enqueue(async () => {
        await persist((s) => removeWatchOp(s, id));
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
    async (id: string, enabled: boolean) => {
      await enqueue(async () => {
        await persist((s) => updateWatchOp(s, id, { enabled }));
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
    async (id: string, alias: string) => {
      await enqueue(async () => {
        await persist((s) => updateWatchOp(s, id, { alias }));
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

      // 邮箱通知（默认关闭；未配置时 sendMail 会静默返回）
      if (settings.emailEnabled && settings.emailTo) {
        for (const it of result.items) {
          if (it.ok && it.newItems.length > 0) {
            await sendNewProjectsMail(it.orgName, it.newItems, settings.emailTo).catch(() => undefined);
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
    async (id: string) => {
      const watch = stateRef.current.watches.find((w) => w.id === id);
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

  const value = useMemo<StoreValue>(
    () => ({
      ready, state, checking, lastRunMessage, bg,
      addWatchFromUrl, removeWatch, setWatchEnabled, renameWatch,
      checkAll, checkOneWatch, updateSettings,
      markAllNotificationsRead, clearAllNotifications, resetAll,
      refreshBgStatus,
    }),
    [
      ready, state, checking, lastRunMessage, bg,
      addWatchFromUrl, removeWatch, setWatchEnabled, renameWatch,
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
