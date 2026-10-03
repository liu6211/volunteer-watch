/**
 * 后台任务定义
 *
 * ⚠️ 重要：TaskManager.defineTask 必须在「全局作用域」调用，
 * 不能在 React 组件生命周期里调用，否则 App 在后台被唤醒时任务不存在。
 * 所以这个文件只做定义，由 app/_layout.tsx 在模块顶层 import 一次。
 *
 * 平台行为差异（来自 Expo 官方文档）：
 *   - Android：WorkManager，最小间隔 15 分钟，系统按省电策略择机执行
 *   - iOS：BGTaskScheduler，系统决定何时运行，短间隔常被忽略，
 *          通常在夜间等窗口执行；App 被上滑杀掉后不再运行
 */
import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { runCheck } from './checker';
import { loadState, saveState, pushNotifications } from './storage';
import { presentLocalNotification } from './notifications';

export const BACKGROUND_TASK_NAME = 'volunteer-watch-check';

/** 后台检查的最小间隔：15 分钟（Android 的硬性下限） */
export const MIN_INTERVAL_MINUTES = 15;

/** 把分钟数收敛到平台允许的范围 */
export function clampInterval(minutes: number): number {
  const n = Number(minutes);
  if (!Number.isFinite(n)) return 60;
  return Math.max(MIN_INTERVAL_MINUTES, Math.min(24 * 60, Math.round(n)));
}

// ---------------------------------------------------------------- 任务定义

/**
 * 后台任务的运行痕迹。
 * 存在模块变量里，同时写进存储 —— 这样设置页能显示
 * 「到底有没有跑过、上次跑是什么时候、失败原因是什么」，
 * 而不是让用户对着一个「已开启」的开关猜。
 */
let lastRunAt: string | null = null;
let lastError: string | null = null;

const TRACE_KEY = 'volunteer-watch.bg-trace.v1';

async function saveTrace() {
  try {
    await AsyncStorage.setItem(TRACE_KEY, JSON.stringify({ lastRunAt, lastError }));
  } catch { /* 忽略 */ }
}

async function loadTrace() {
  try {
    const raw = await AsyncStorage.getItem(TRACE_KEY);
    if (raw) {
      const o = JSON.parse(raw) as { lastRunAt?: string; lastError?: string };
      lastRunAt = o.lastRunAt ?? null;
      lastError = o.lastError ?? null;
    }
  } catch { /* 忽略 */ }
}
void loadTrace();

TaskManager.defineTask(BACKGROUND_TASK_NAME, async () => {
  try {
    const state = await loadState();

    if (!state.settings.backgroundCheckEnabled) {
      return BackgroundTask.BackgroundTaskResult.Success;
    }

    const result = await runCheck(state.watches, true);

    const nextState = pushNotifications(
      { ...state, watches: result.watches },
      result.items
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
        }))
    );

    await saveState(nextState);

    // 后台发现新项目时也发本地通知
    if (state.settings.notificationsEnabled) {
      for (const it of result.items) {
        if (it.ok && it.newItems.length > 0) {
          await presentLocalNotification(it.title, it.body, { orgId: it.orgId });
        }
      }
    }

    lastRunAt = new Date().toISOString();
    lastError = null;
    await saveTrace();
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch (e) {
    lastError = (e as Error).message || String(e);
    await saveTrace();
    console.warn('[background] 后台检查失败', e);
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

// ---------------------------------------------------------------- 注册管理

/**
 * 注册后台任务。
 *
 * ⚠️ 之前这里只要 availability !== 'available' 就直接 return，
 * 而真机上这个探测经常返回 unknown / restricted，
 * 结果就是【从来没注册过】，开关显示开着但永远不会检查。
 * 现在改成：不管探测结果如何都尝试注册，并把真实失败原因记下来给界面显示。
 */
export async function registerBackgroundTask(intervalMinutes: number): Promise<void> {
  const interval = clampInterval(intervalMinutes);
  try {
    await BackgroundTask.registerTaskAsync(BACKGROUND_TASK_NAME, {
      minimumInterval: interval,
    });
    lastError = null;
    await saveTrace();
    console.log(`[background] 已注册，最小间隔 ${interval} 分钟`);
  } catch (e) {
    lastError = (e as Error).message || String(e);
    await saveTrace();
    console.log('[background] 注册后台任务失败：', lastError);
    // 再试一次：某些机型第一次调用会因为初始化未完成而失败
    try {
      await BackgroundTask.registerTaskAsync(BACKGROUND_TASK_NAME, {
        minimumInterval: MIN_INTERVAL_MINUTES,
      });
      lastError = null;
      await saveTrace();
      console.log('[background] 重试后注册成功');
    } catch (e2) {
      lastError = (e2 as Error).message || String(e2);
      await saveTrace();
    }
  }
}

/** 取消后台任务 */
export async function unregisterBackgroundTask(): Promise<void> {
  try {
    const registered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_TASK_NAME);
    if (registered) {
      await BackgroundTask.unregisterTaskAsync(BACKGROUND_TASK_NAME);
    }
  } catch (e) {
    console.log('[background] 取消后台任务失败，已忽略：', (e as Error).message);
  }
}

/** 后台任务可用性（归一化成字符串，避免 UI 直接依赖原生枚举） */
export type BackgroundAvailability = 'available' | 'restricted' | 'unknown';

export interface BackgroundStatus {
  availability: BackgroundAvailability;
  registered: boolean;
  /** 最近一次注册失败的原因，null 表示没出错 */
  lastError: string | null;
  /** 最近一次后台任务真正跑起来的时间（ISO），null 表示从没跑过 */
  lastRunAt: string | null;
}

/** 查询后台任务状态 */
export async function getBackgroundStatus(): Promise<BackgroundStatus> {
  try {
    const status = await BackgroundTask.getStatusAsync();
    const registered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_TASK_NAME);

    let availability: BackgroundAvailability = 'unknown';
    if (status === BackgroundTask.BackgroundTaskStatus.Available) availability = 'available';
    else if (status === BackgroundTask.BackgroundTaskStatus.Restricted) availability = 'restricted';

    await loadTrace();
    return { availability, registered, lastError, lastRunAt };
  } catch {
    return { availability: 'unknown', registered: false, lastError, lastRunAt };
  }
}
