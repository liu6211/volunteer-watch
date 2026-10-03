/**
 * 全局数据类型定义
 */
import type { OppItem, CountTable } from '../core/parser.mjs';
export type { OppItem };

/** 被监控的团体 */
export interface WatchItem {
  /**
   * 主键 = `${host}~${id}`。
   *
   * ⚠️ 为什么不能只用 id：志愿云各省分站是独立站点，
   * 同一个 id 在不同域名下是不同的团体（甚至可能不存在）。
   * 早期版本只按 id 去重，导致「同 id 不同域名」被误判为重复，
   * 删除时也会把另一个站点的一起删掉。
   */
  key: string;
  /** 团体 id（如 Vl6t7DSgAHI3O） */
  id: string;
  /** 站点域名，如 gz.zhiyuanyun.com */
  host: string;
  /** 规范化后的团体主页链接 */
  url: string;
  /** 团体名称（首次抓取后填充） */
  name: string;
  /** 用户自定义备注，默认等于团体名 */
  alias?: string;
  /** 是否启用监控 */
  enabled: boolean;
  /** 上次检查时间（ISO） */
  lastCheckedAt?: string;
  /** 上次检查结果说明（成功/失败原因） */
  lastResult?: string;
  /**
   * 已知项目的指纹计数表（去重依据）。
   * 注意不能用项目 id：站点对 id 做了会话级加密，每次请求都变。
   */
  knownCounts: CountTable;
  /** 最近一次抓到的项目列表，供详情页展示 */
  projects: OppItem[];
  /** 首次添加时间 */
  addedAt: string;
}

/** 通知历史里的一条记录 */
export interface StoredNotification {
  id: string;
  /** 团体 id */
  orgId: string;
  orgName: string;
  title: string;
  body: string;
  /** 关联的新项目 id */
  oppIds: string[];
  createdAt: string;
  read: boolean;
}

/** 把域名和团体 id 合成主键。用 ~ 分隔，避免 # / 等 URL 保留字符 */
export function makeWatchKey(host: string, id: string): string {
  return `${host}~${id}`;
}

/** 邮件发送方式：直接用邮箱账号发（SMTP） */
export type EmailProvider = 'none' | 'smtp';

/** 界面主题：跟随系统 / 强制浅色 / 强制深色 */
export type ThemeMode = 'system' | 'light' | 'dark';

/** 应用设置 */
export interface AppSettings {
  /** 是否开启通知 */
  notificationsEnabled: boolean;
  /** 检查间隔（分钟），Android 后台最小 15 */
  intervalMinutes: number;
  /** 是否启用定时自动检查 */
  backgroundCheckEnabled: boolean;
  /** 界面主题（可手动切换，不再只跟随系统） */
  themeMode: ThemeMode;

  /* ---------------------------------------------------- 排班提醒 */
  /**
   * 根据「我的排班」里的开始日期自动排定时提醒。
   * 用本地定时通知实现 —— App 关掉也会响，不依赖实时活动。
   */
  shiftReminderEnabled: boolean;
  /** 提前几天提醒（0 = 当天） */
  shiftReminderDaysAhead: number;
  /** 当天几点提醒（0-23），只在 daysAhead=0 时用；提前提醒固定在 20:00 */
  shiftReminderHour: number;

  /* ---------------------------------------------------- iOS 实时活动 */
  /**
   * 是否「上岛」：把正在进行的服务显示在锁屏 / 灵动岛（Live Activity）。
   *
   * 这需要原生 Widget 扩展，**Expo Go 里一定不生效**，
   * 只有 development build / 正式包才行。所以单独做成开关，
   * 关掉时只走普通的定时通知。
   */
  liveActivityEnabled: boolean;

  /* ---------------------------------------------------- 邮箱通知 */
  /** 邮箱通知开关 */
  emailEnabled: boolean;
  /** 收件邮箱（不填就发给自己） */
  emailTo: string;
  /** 发送方式。目前只有一种：用自己的邮箱账号直发 */
  emailProvider: EmailProvider;
  /**
   * 发信邮箱，例如 you@qq.com。
   * 只有 QQ 邮箱需要用到，因为发信走 QQ 的 SMTP 服务器。
   */
  emailUser: string;
  /**
   * 邮箱授权码（不是登录密码！QQ 邮箱在设置里生成）。
   *
   * 说明：它只能用来发信，不能登录你的邮箱账号，
   * 存在 App 自己的私有存储里，其它 App 读不到。
   */
  emailPass: string;
  /** 是否把失败原因记到通知记录里，便于排查 */
  emailLogErrors: boolean;
}

/**
 * 已登录的账号会话。
 *
 * ⚠️ 只存会话 Cookie，【绝不存密码】。
 * 会话过期后让用户重新登录即可。
 */
export interface AccountSession {
  /** 登录用的用户名（志愿者编号也行） */
  username: string;
  /** 会话 Cookie（PHPSESSID） */
  cookie: string;
  /** 登录页里的 seid 令牌 */
  seid: string;
  /** 登录时间（ISO） */
  loginAt: string;
  /** 上次成功拉取数据的时间 */
  lastSyncAt?: string;
  /**
   * 登录时哪种 Cookie 模式生效（platform / manual）。
   * 后续所有请求必须沿用同一种，否则会变成
   * 「Cookie 是旧的、seid 是新的」→ 服务器回「访问超时」。
   */
  cookieMode?: string;
}

/** 整个应用的持久化状态 */
export interface AppState {
  version: number;
  watches: WatchItem[];
  notifications: StoredNotification[];
  settings: AppSettings;
  /** 团体搜索历史（最近在前，最多 12 条） */
  searchHistory: string[];
  /** 志愿云账号会话，未登录为 null */
  account: AccountSession | null;
}

/** 搜索历史最多保留几条 */
export const MAX_SEARCH_HISTORY = 12;

export const DEFAULT_SETTINGS: AppSettings = {
  notificationsEnabled: true,
  intervalMinutes: 15,
  backgroundCheckEnabled: true,
  themeMode: 'system',

  shiftReminderEnabled: false,
  shiftReminderDaysAhead: 1,
  shiftReminderHour: 7,

  // 默认关闭：需要原生扩展，Expo Go 里不会生效，让用户自己决定
  liveActivityEnabled: false,

  emailEnabled: false,
  emailTo: '',
  emailProvider: 'none',
  emailUser: '',
  emailPass: '',
  emailLogErrors: true,
};

export const EMPTY_STATE: AppState = {
  version: 1,
  watches: [],
  notifications: [],
  settings: DEFAULT_SETTINGS,
  searchHistory: [],
  account: null,
};
