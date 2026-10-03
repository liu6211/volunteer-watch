/**
 * 排班实时活动（上岛）的桥接层
 *
 * ⚠️ expo-widgets 是原生模块，**Expo Go 里没有**：
 *   - 直接 `import` 在 Expo Go 中会因找不到原生模块而报错
 *   - 所以这里用「懒加载 + try/catch」，拿不到就静默降级
 *   - 这样 Expo Go 里跑起来完全正常，只是没有上岛效果
 *
 * 与定时通知的分工：
 *   定时通知（reminders.ts）→ 提前提醒，App 关掉也会响
 *   实时活动（本文件）      → 服务进行时在锁屏/灵动岛显示倒计时
 * 两者互不依赖，设置里分别开关。
 */
import { Platform } from 'react-native';

import type { AppSettings } from './types';
import type { Shift } from './reminders';

export type ShiftActivityProps = {
  title: string;
  content: string;
  startAt: number;
  endAt: number;
  place: string;
};

/** 当前活动的实例（每次 start 后记住，便于 update / end） */
type ActivityInstance = {
  update: (props: ShiftActivityProps) => Promise<void>;
  end: (policy?: unknown, props?: ShiftActivityProps, contentDate?: Date) => Promise<void>;
};

let current: ActivityInstance | null = null;
let currentKey = '';

/**
 * 懒加载 expo-widgets。
 * 在 Expo Go / Android / 未配置扩展的包上会返回 null，不抛错。
 */
function loadModule(): { factory: any; after: any } | null {
  if (Platform.OS !== 'ios') return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const widgets = require('expo-widgets');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const activity = require('../live/ShiftActivity');
    const factory = activity?.default;
    if (!factory || typeof factory.start !== 'function') return null;
    return { factory, after: widgets?.after };
  } catch {
    // Expo Go：原生模块不存在，正常降级
    return null;
  }
}

/** 这套包到底能不能上岛（不是 Expo Go、且是 iOS、且扩展已配置） */
export function isLiveActivityAvailable(): boolean {
  return loadModule() !== null;
}

/** 实时活动是否该生效：设置开着 + 平台支持 */
export function shouldUseLiveActivity(settings: AppSettings): boolean {
  return Boolean(settings.liveActivityEnabled) && isLiveActivityAvailable();
}

/**
 * 开始（或更新）一条排班的实时活动。
 * 同一时刻只保留一条 —— 换了排班就结束旧的再开新的。
 */
export async function startShiftActivity(
  shift: Shift,
  place = ''
): Promise<{ ok: boolean; message: string; skipped?: boolean }> {
  const mod = loadModule();
  if (!mod) {
    return { ok: false, skipped: true, message: '当前环境暂不支持实时活动' };
  }

  const props: ShiftActivityProps = {
    title: shift.title || '志愿服务',
    content: shift.content || '',
    startAt: shift.startAt.getTime(),
    endAt: (shift.endAt ?? new Date(shift.startAt.getTime() + 2 * 60 * 60 * 1000)).getTime(),
    place,
  };

  try {
    if (current && currentKey === shift.key) {
      await current.update(props);
      return { ok: true, message: '已更新锁屏倒计时' };
    }

    // 换排班：先收掉旧的，避免锁屏上堆两条
    if (current) {
      await current.end('immediate').catch(() => undefined);
      current = null;
      currentKey = '';
    }

    // 深链：点实时活动回到这个项目
    const url = `volunteerwatch://project/${encodeURIComponent(shift.title)}`;
    const instance: ActivityInstance = mod.factory.start(props, url);
    current = instance;
    currentKey = shift.key;
    return { ok: true, message: '已上岛，锁屏和灵动岛会显示倒计时' };
  } catch (e) {
    return { ok: false, message: `上岛失败：${(e as Error).message}` };
  }
}

/** 结束当前实时活动 */
export async function endShiftActivity(): Promise<void> {
  if (!current) return;
  const inst = current;
  current = null;
  currentKey = '';
  try {
    await inst.end('immediate');
  } catch {
    // 已经结束了就算了
  }
}

/** 当前有没有正在显示的实时活动 */
export function hasRunningActivity(): boolean {
  return current !== null;
}
