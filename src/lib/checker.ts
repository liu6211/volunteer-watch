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
  /** 是否是【首次检查】（只登记基准，不通知） */
  firstRun?: boolean;
}

/**
 * 检查单个团体
 * @param watch 监控对象
 */
export async function checkOne(watch: WatchItem): Promise<CheckOneResult> {
  try {
    const snapshot = await fetchOrgSnapshot(watch.url, { host: watch.host, timeoutMs: 20000 });

    /*
     * 首次检查没有基准，findNewProjects 会把全部项目都当成「新的」。
     * 这时不能通知 —— 否则一添加监控就会收到几十条推送，
     * 全是早就存在的项目。所以首次只登记基准。
     */
    const firstRun = !watch.knownCounts || Object.keys(watch.knownCounts).length === 0;

    const detected = findNewProjects(snapshot.projects, watch.knownCounts);
    const newItems = detected.map((d) => d.item);
    const total = snapshot.projects.length;

    /*
     * 文案要说清楚「首次检查为什么不通知」——
     * 否则用户看到「没有新项目（共 20 个）」会想：
     * 这 20 个它是怎么知道不算新的？为什么一个都没提醒？
     */
    const message = firstRun
      ? `已登记 ${total} 个现有项目（首次检查只记录基准，以后有新项目才会通知）`
      : newItems.length
        ? `发现 ${newItems.length} 个新项目`
        : `没有新项目（共 ${total} 个）`;

    return {
      watch: applySnapshotToWatch(watch, snapshot, message),
      newItems,
      message,
      ok: true,
      snapshot,
      firstRun,
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
  /** 首次检查（只登记基准，不通知） */
  firstRun: boolean;
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
        firstRun: false,
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
        firstRun: false,
      });
    } else if (r.firstRun) {
      // 首次检查没有基准，只是登记。放进 items 里只为让界面能说明白，
      // newItems 是空的 —— 所以不会触发通知。
      items.push({
        orgId: w.id,
        orgName: w.name,
        newItems: [],
        title: '',
        body: '',
        ok: true,
        message: r.message,
        firstRun: true,
      });
    }
  }

  // 未参与检查的（被禁用的）原样保留
  const skipped = watches.filter((w) => !targets.includes(w));
  return { watches: [...updated, ...skipped], items, totalNew };
}
