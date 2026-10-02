/**
 * 后台任务 —— web 平台降级实现
 *
 * web 上不存在「后台任务」这个概念（也没有 expo-background-task /
 * expo-task-manager 的原生支持），所以这里提供一组同名空实现，
 * 保证 App 在 web 上能正常跑起来，只是不具备后台自动检查能力。
 *
 * Metro 会按平台自动选择文件：
 *   - iOS / Android → backgroundTask.native.ts
 *   - web           → backgroundTask.web.ts（本文件）
 */

export const BACKGROUND_TASK_NAME = 'volunteer-watch-check';
export const MIN_INTERVAL_MINUTES = 15;

/** 把分钟数收敛到平台允许的范围 */
export function clampInterval(minutes: number): number {
  const n = Number(minutes);
  if (!Number.isFinite(n)) return 60;
  return Math.max(MIN_INTERVAL_MINUTES, Math.min(24 * 60, Math.round(n)));
}

/** 后台任务可用性（与 native 版本保持同一套类型） */
export type BackgroundAvailability = 'available' | 'restricted' | 'unknown';

export interface BackgroundStatus {
  availability: BackgroundAvailability;
  registered: boolean;
}

/** web 上不支持后台任务 */
export async function registerBackgroundTask(_intervalMinutes: number): Promise<void> {
  console.log('[background/web] 网页版不支持后台任务，已跳过注册');
}

export async function unregisterBackgroundTask(): Promise<void> {
  // 无需处理
}

export async function getBackgroundStatus(): Promise<BackgroundStatus> {
  return { availability: 'restricted', registered: false };
}
