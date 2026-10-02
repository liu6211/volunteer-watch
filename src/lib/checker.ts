/**
 * 检查逻辑：抓取一个团体的页面，找出新项目
 */
import { fetchOrgSnapshot, findNewProjects, buildNotificationText } from '../core/parser.mjs';
import type { OppItem, OrgSnapshot, CountTable } from '../core/parser.mjs';
import { applySnapshotToWatch } from './storage';
import type { WatchItem } from './types';

export interface CheckOneResult {
  /** 更新后的监控对象（无论成功失败都应写回） */
  watch: WatchItem;
  /** 新发现的项目 */
  newItems: OppItem[];
  /** 本次结果描述，用于界面展示 */
  message: string;
  /** 整体是否成功 */
  ok: boolean;
  /** 成功抓取时的快照 */
  snapshot?: OrgSnapshot;
}

/**
 * 检查单个团体
 * @param watch 监控对象
 */
export async function checkOne(watch: WatchItem): Promise<CheckOneResult> {
  try {
    const snapshot = await fetchOrgSnapshot(watch.url, { host: watch.host, timeoutMs: 20000 });

    const detected = findNewProjects(snapshot.projects, watch.knownCounts);
    const newItems = detected.map((d) => d.item);

    const message = newItems.length
      ? `发现 ${newItems.length} 个新项目`
      : `没有新项目（共 ${snapshot.projects.length} 个）`;

    return {
      watch: applySnapshotToWatch(watch, snapshot, message),
      newItems,
      message,
      ok: true,
      snapshot,
    };
  } catch (e) {
    const message = `检查失败：${(e as Error).message}`;
    return {
      watch: {
        ...watch,
        lastCheckedAt: new Date().toISOString(),
        lastResult: message,
      },
      newItems: [],
      message,
      ok: false,
    };
  }
}

/** 单次检查里，一个团体产生的结果（供 UI 决定弹什么通知） */
export interface CheckRunItem {
  orgId: string;
  orgName: string;
  newItems: OppItem[];
  title: string;
  body: string;
  ok: boolean;
  message: string;
}

export interface CheckRunResult {
  /** 检查过的监控对象（新状态） */
  watches: WatchItem[];
  /** 有变动的团体（含失败项，便于提示） */
  items: CheckRunItem[];
  /** 新项目总数 */
  totalNew: number;
}

/**
 * 检查一批团体
 * @param watches 监控列表
 * @param onlyEnabled 是否只检查启用的
 */
export async function runCheck(
  watches: WatchItem[],
  onlyEnabled = true
): Promise<CheckRunResult> {
  const targets = onlyEnabled ? watches.filter((w) => w.enabled) : watches;
  const updated: WatchItem[] = [];
  const items: CheckRunItem[] = [];
  let totalNew = 0;

  // 逐个检查，避免同时打太多请求给对方站点造成压力
  for (const w of targets) {
    const r = await checkOne(w);
    updated.push(r.watch);
    totalNew += r.newItems.length;

    if (r.newItems.length > 0) {
      const orgName = r.watch.name;
      const text = buildNotificationText(orgName, r.newItems);
      items.push({
        orgId: w.id,
        orgName,
        newItems: r.newItems,
        title: text.title,
        body: text.body,
        ok: true,
        message: r.message,
      });
    } else if (!r.ok) {
      items.push({
        orgId: w.id,
        orgName: w.name,
        newItems: [],
        title: `检查失败：${w.name}`,
        body: r.message,
        ok: false,
        message: r.message,
      });
    }
  }

  // 未参与检查的（被禁用的）原样保留
  const skipped = watches.filter((w) => !targets.includes(w));
  return { watches: [...updated, ...skipped], items, totalNew };
}
