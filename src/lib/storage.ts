/**
 * 持久化存储层（AsyncStorage）
 * 所有写入都经过这里，避免多处直接读写存储造成状态不一致。
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { EMPTY_STATE, DEFAULT_SETTINGS, MAX_SEARCH_HISTORY, makeWatchKey } from './types';
import type { AppState, WatchItem, StoredNotification } from './types';
import type { OppItem, CountTable } from '../core/parser.mjs';

const STATE_KEY = 'volunteer-watch:state:v1';

/** 通知历史上限，避免无限增长 */
const MAX_NOTIFICATIONS = 300;

/**
 * 读取整个状态；损坏或为空时返回空状态
 * @returns {Promise<AppState>}
 */
export async function loadState(): Promise<AppState> {
  try {
    const raw = await AsyncStorage.getItem(STATE_KEY);
    if (!raw) return { ...EMPTY_STATE };
    const parsed = JSON.parse(raw) as Partial<AppState>;
    const watches = (Array.isArray(parsed.watches) ? parsed.watches : [])
      .map(migrateWatch)
      .filter((w): w is WatchItem => w !== null);

    return {
      version: 1,
      watches,
      notifications: Array.isArray(parsed.notifications) ? parsed.notifications : [],
      settings: { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) },
      searchHistory: Array.isArray(parsed.searchHistory)
        ? (parsed.searchHistory as string[]).filter((s) => typeof s === 'string')
        : [],
      // 会话里只应存在 username/cookie/seid，这里做一次白名单过滤，
      // 防止旧数据里混进不该留的字段
      account:
        parsed.account && typeof parsed.account === 'object' && parsed.account.username
          ? {
              username: String(parsed.account.username),
              cookie: String(parsed.account.cookie || ''),
              seid: String(parsed.account.seid || ''),
              loginAt: String(parsed.account.loginAt || new Date().toISOString()),
              lastSyncAt: parsed.account.lastSyncAt
                ? String(parsed.account.lastSyncAt)
                : undefined,
              cookieMode: parsed.account.cookieMode
                ? String(parsed.account.cookieMode)
                : undefined,
            }
          : null,
    };
  } catch (e) {
    console.warn('[storage] 读取状态失败，使用空状态', e);
    return { ...EMPTY_STATE };
  }
}

/**
 * 写入整个状态
 * @param {AppState} state
 */
export async function saveState(state: AppState): Promise<void> {
  const trimmed: AppState = {
    ...state,
    notifications: state.notifications.slice(0, MAX_NOTIFICATIONS),
  };
  await AsyncStorage.setItem(STATE_KEY, JSON.stringify(trimmed));
}

/** 清空所有数据 */
export async function clearState(): Promise<void> {
  await AsyncStorage.removeItem(STATE_KEY);
}

/* ------------------------------------------------------------------ 操作 */

/** 添加一个监控目标，返回新状态 */
export function addWatch(state: AppState, watch: WatchItem): AppState {
  // 按 key（域名+id）判重，而不是只按 id —— 同 id 不同站点是两个团体
  if (state.watches.some((w) => w.key === watch.key)) {
    throw new Error(`这个团体已经在监控列表里了（${watch.host}）`);
  }
  return { ...state, watches: [...state.watches, watch] };
}

/** 删除监控目标 */
export function removeWatch(state: AppState, key: string): AppState {
  return { ...state, watches: state.watches.filter((w) => w.key !== key) };
}

/** 修改监控目标 */
export function updateWatch(
  state: AppState,
  key: string,
  patch: Partial<WatchItem>
): AppState {
  return {
    ...state,
    watches: state.watches.map((w) => (w.key === key ? { ...w, ...patch } : w)),
  };
}

/** 更新设置 */
export function updateSettings(state: AppState, patch: Partial<AppState['settings']>): AppState {
  return { ...state, settings: { ...state.settings, ...patch } };
}

/** 追加通知记录 */
export function pushNotifications(
  state: AppState,
  items: StoredNotification[]
): AppState {
  if (items.length === 0) return state;
  return {
    ...state,
    notifications: [...items, ...state.notifications].slice(0, MAX_NOTIFICATIONS),
  };
}

/** 全部标记已读 */
export function markAllRead(state: AppState): AppState {
  return {
    ...state,
    notifications: state.notifications.map((n) => ({ ...n, read: true })),
  };
}

/** 清空通知历史 */
export function clearNotifications(state: AppState): AppState {
  return { ...state, notifications: [] };
}

/* -------------------------------------------------- 搜索历史 */

/** 记一条搜索关键词（去重、最近的排前面、最多 MAX_SEARCH_HISTORY 条） */
export function pushSearchHistory(state: AppState, keyword: string): AppState {
  const kw = String(keyword ?? '').trim();
  if (!kw) return state;
  const rest = (state.searchHistory || []).filter((s) => s !== kw);
  return { ...state, searchHistory: [kw, ...rest].slice(0, MAX_SEARCH_HISTORY) };
}

/** 删掉某一条搜索历史 */
export function removeSearchHistory(state: AppState, keyword: string): AppState {
  return {
    ...state,
    searchHistory: (state.searchHistory || []).filter((s) => s !== keyword),
  };
}

/** 清空搜索历史 */
export function clearSearchHistory(state: AppState): AppState {
  return { ...state, searchHistory: [] };
}

/* ------------------------------------------------------------------ 辅助 */

/** 生成一个监控目标的初始对象 */
export function makeWatch(params: {
  id: string;
  host: string;
  url: string;
  name?: string;
}): WatchItem {
  return {
    key: makeWatchKey(params.host, params.id),
    id: params.id,
    host: params.host,
    url: params.url,
    name: params.name || params.id,
    enabled: true,
    knownCounts: {},
    projects: [],
    addedAt: new Date().toISOString(),
  };
}

/**
 * 用快照结果更新监控目标的展示信息。
 * knownCounts 会被替换成本次的计数表 —— 这是下次比较的基线。
 */
export function applySnapshotToWatch(
  watch: WatchItem,
  snapshot: { orgId?: string; orgName: string; projects: OppItem[]; counts: CountTable },
  lastResult: string
): WatchItem {
  return {
    ...watch,
    // 存下站点给的数字团体编号：翻页浏览「发起的项目」要用它调 get_opps
    orgId: snapshot.orgId || watch.orgId,
    name: snapshot.orgName || watch.name,
    knownCounts: snapshot.counts,
    projects: snapshot.projects,
    lastCheckedAt: new Date().toISOString(),
    lastResult,
  };
}

/**
 * 兼容旧版本数据结构。
 *
 * 修过两处历史问题：
 *   1. 早期用 knownIds（项目 id 数组）去重，但实测发现项目 id 每次请求都变，
 *      该方案不可用 → 改成指纹计数表；无法还原时给空表，下次检查重建基线（不会误报）。
 *   2. 早期把团体 id 当主键，忽略了所在站点。志愿云各省分站是独立站点，
 *      同 id 不同域名是两个不同团体 → 补上 key = host~id。
 */
function migrateWatch(raw: unknown): WatchItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const w = raw as Record<string, unknown>;
  if (typeof w.id !== 'string' || !w.id) return null;

  const host = typeof w.host === 'string' && w.host ? w.host : 'gz.zhiyuanyun.com';

  const knownCounts =
    w.knownCounts && typeof w.knownCounts === 'object'
      ? (w.knownCounts as Record<string, number>)
      : {};

  return {
    // 旧数据没有 key，按 host+id 补出来
    key: typeof w.key === 'string' && w.key ? w.key : makeWatchKey(host, w.id),
    id: w.id,
    host,
    url: typeof w.url === 'string' ? w.url : '',
    name: typeof w.name === 'string' ? w.name : w.id,
    alias: typeof w.alias === 'string' ? w.alias : undefined,
    enabled: w.enabled !== false,
    lastCheckedAt: typeof w.lastCheckedAt === 'string' ? w.lastCheckedAt : undefined,
    lastResult: typeof w.lastResult === 'string' ? w.lastResult : undefined,
    knownCounts,
    projects: Array.isArray(w.projects) ? (w.projects as OppItem[]) : [],
    addedAt: typeof w.addedAt === 'string' ? w.addedAt : new Date().toISOString(),
  };
}
