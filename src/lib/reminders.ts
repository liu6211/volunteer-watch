/**
 * 排班定时提醒
 *
 * 用【本地定时通知】实现 —— 这是 iOS 上做「提前提醒」最可靠的方式：
 *   - 不需要实时活动（Live Activity）
 *   - App 关掉也会响（系统级投递）
 *   - 可以一次排很多条
 *
 * 实时活动（灵动岛倒计时）是另一回事，见 liveActivity.ts：
 * 那个只在服务「正在进行时」显示，且必须原生扩展。
 */
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { ensureAndroidChannel, requestNotificationPermission } from './notifications';
import type { AppSettings } from './types';

/** 一条排班 */
export interface Shift {
  /** 稳定标识，用于去重与取消 */
  key: string;
  /** 项目名称 */
  title: string;
  /** 排班内容 */
  content: string;
  /** 开始时间（本地时区） */
  startAt: Date;
  /** 结束时间（可能没有） */
  endAt: Date | null;
}

/** 每条提醒在通知里带的标识前缀，方便整体取消 */
const ID_PREFIX = 'shift-reminder:';

/**
 * 解析排班的日期文本。
 * 站点给的是「开始日期 / 结束日期」两列，格式可能是：
 *   2026-10-05            （只有日期）
 *   2026-10-05 08:00      （带时间）
 *   2026-10-05 08:00:00
 * @returns 解析失败返回 null
 */
function parseWhen(raw: string): Date | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;

  // 2026-10-05 或 2026/10/05，后面可能跟时间
  const m = s.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return null;

  const [, y, mo, d, hh, mi, ss] = m;
  const date = new Date(
    Number(y),
    Number(mo) - 1,
    Number(d),
    hh ? Number(hh) : 0,
    mi ? Number(mi) : 0,
    ss ? Number(ss) : 0
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * 把「我的排班」表格转成排班列表。
 *
 * 表头实测为：状态 / 开始日期 / 结束日期 / 排班内容 / 项目名称 / 联系方式
 * 但顺序可能变，所以按表头名去找列，找不到再退回固定下标。
 */
export function parseShifts(headers: string[], rows: string[][]): Shift[] {
  const col = (...names: string[]) => {
    for (const n of names) {
      const i = headers.findIndex((h) => String(h ?? '').includes(n));
      if (i >= 0) return i;
    }
    return -1;
  };

  const iStart = col('开始') >= 0 ? col('开始') : 1;
  const iEnd = col('结束') >= 0 ? col('结束') : 2;
  const iContent = col('排班内容', '内容') >= 0 ? col('排班内容', '内容') : 3;
  const iTitle = col('项目名称', '项目') >= 0 ? col('项目名称', '项目') : 4;

  const out: Shift[] = [];
  for (const r of rows || []) {
    const startAt = parseWhen(r[iStart]);
    if (!startAt) continue; // 没有开始时间就没法提醒

    const endAt = parseWhen(r[iEnd]);
    const title = String(r[iTitle] ?? '').trim() || '志愿服务';
    const content = String(r[iContent] ?? '').trim();

    out.push({
      // 用「开始时间 + 标题 + 内容」当 key：站点给出的其它 id 都不稳定
      key: `${startAt.getTime()}|${title}|${content}`,
      title,
      content,
      startAt,
      endAt,
    });
  }
  return out;
}

/** 算出某条排班应该在什么时刻提醒 */
function reminderTimes(shift: Shift, settings: AppSettings): Date[] {
  const days = Math.max(0, Math.min(30, Number(settings.shiftReminderDaysAhead) || 0));
  const out: Date[] = [];

  if (days > 0) {
    // 提前 N 天的 20:00
    const d = new Date(shift.startAt);
    d.setDate(d.getDate() - days);
    d.setHours(20, 0, 0, 0);
    out.push(d);
  } else {
    // 当天：用设置里的小时；如果排班本身有时间，就提前 1 小时
    const hasTime = shift.startAt.getHours() !== 0 || shift.startAt.getMinutes() !== 0;
    if (hasTime) {
      const d = new Date(shift.startAt.getTime() - 60 * 60 * 1000);
      out.push(d);
    } else {
      const d = new Date(shift.startAt);
      d.setHours(Math.max(0, Math.min(23, Number(settings.shiftReminderHour) || 7)), 0, 0, 0);
      out.push(d);
    }
  }

  // 只保留未来的时刻
  const now = Date.now();
  return out.filter((d) => d.getTime() > now + 30 * 1000);
}

/** 先清掉所有旧的排班提醒 */
export async function cancelShiftReminders(): Promise<void> {
  if (!(Platform.OS === 'ios' || Platform.OS === 'android')) return;
  const all = await Notifications.getAllScheduledNotificationsAsync().catch(() => []);
  for (const n of all) {
    const id = String(n.identifier ?? '');
    const isOurs = id.startsWith(ID_PREFIX) ||
      String(n.content?.data?.kind ?? '') === 'shift-reminder';
    if (isOurs) {
      await Notifications.cancelScheduledNotificationAsync(id).catch(() => undefined);
    }
  }
}

/** 按当前排班重新排提醒（先清后建，幂等） */
export async function scheduleShiftReminders(
  shifts: Shift[],
  settings: AppSettings
): Promise<{ scheduled: number; skipped: number }> {
  if (!(Platform.OS === 'ios' || Platform.OS === 'android')) {
    return { scheduled: 0, skipped: shifts.length };
  }

  await cancelShiftReminders();

  if (!settings.shiftReminderEnabled) {
    return { scheduled: 0, skipped: 0 };
  }

  const granted = await requestNotificationPermission();
  if (!granted) return { scheduled: 0, skipped: shifts.length };

  await ensureAndroidChannel();

  let scheduled = 0;
  let skipped = 0;

  for (const shift of shifts) {
    const times = reminderTimes(shift, settings);
    if (times.length === 0) {
      skipped++;
      continue;
    }

    for (const when of times) {
      const bodyBits = [
        shift.content,
        shift.endAt ? `到 ${shift.endAt.toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit' })}` : '',
      ].filter(Boolean);

      await Notifications.scheduleNotificationAsync({
        identifier: `${ID_PREFIX}${shift.key}|${when.getTime()}`,
        content: {
          title: `服务提醒：${shift.title}`,
          body: bodyBits.length
            ? `${when.toLocaleDateString('zh-CN')} ${bodyBits.join(' · ')}`
            : `${when.toLocaleDateString('zh-CN')} 有志愿服务`,
          sound: true,
          data: { kind: 'shift-reminder', shiftKey: shift.key },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: when,
        },
      });
      scheduled++;
    }
  }

  return { scheduled, skipped };
}

/** 当前已排了多少条提醒（给设置页显示） */
export async function countShiftReminders(): Promise<number> {
  if (!(Platform.OS === 'ios' || Platform.OS === 'android')) return 0;
  const all = await Notifications.getAllScheduledNotificationsAsync().catch(() => []);
  return all.filter(
    (n) =>
      String(n.identifier ?? '').startsWith(ID_PREFIX) ||
      String(n.content?.data?.kind ?? '') === 'shift-reminder'
  ).length;
}
