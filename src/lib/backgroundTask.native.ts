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

    return BackgroundTask.BackgroundTaskResult.Success;
  } catch (e) {
    console.warn('[background] 后台检查失败', e);
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

// ---------------------------------------------------------------- 注册管理

/** 注册后台任务 */
export async function registerBackgroundTask(intervalMinutes: number): Promise<void> {
  // 先探测系统是否允许，再注册。
  // 在 Expo Go 里，宿主 App 的 Info.plist 没有配置
  // UIBackgroundModes → processing，直接调用 registerTaskAsync 会抛
  // BackgroundTasksNotConfigured。所以只有确认可用时才注册。
  const { availability } = await getBackgroundStatus();
  if (availability !== 'available') {
    console.log(
      `[background] 当前环境不支持后台任务（availability=${availability}），已跳过注册。` +
      '在 Expo Go 里这是正常现象，用正式构建的包才会生效。'
    );
    return;
  }
  try {
    await BackgroundTask.registerTaskAsync(BACKGROUND_TASK_NAME, {
      minimumInterval: clampInterval(intervalMinutes),
    });
  } catch (e) {
    // 兜底：某些环境 getStatusAsync 会误报可用，这里不让它冒泡成未捕获异常
    console.log('[background] 注册后台任务失败，已忽略：', (e as Error).message);
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
}

/** 查询后台任务状态 */
export async function getBackgroundStatus(): Promise<BackgroundStatus> {
  try {
    const status = await BackgroundTask.getStatusAsync();
    const registered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_TASK_NAME);

    let availability: BackgroundAvailability = 'unknown';
    if (status === BackgroundTask.BackgroundTaskStatus.Available) availability = 'available';
    else if (status === BackgroundTask.BackgroundTaskStatus.Restricted) availability = 'restricted';

    return { availability, registered };
  } catch {
    return { availability: 'unknown', registered: false };
  }
}
