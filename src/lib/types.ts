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

/** 邮件发送通道 */
export type EmailProvider = 'none' | 'relay' | 'resend' | 'brevo';

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

  /* ---------------------------------------------------- 邮箱通知 */
  /** 邮箱通知开关 */
  emailEnabled: boolean;
  /** 收件邮箱 */
  emailTo: string;
  /** 使用哪种发送通道 */
  emailProvider: EmailProvider;
  /**
   * 中转接口地址（方案 relay）。
   * 这个接口收到的 JSON 形如 { to, subject, text }，
   * 由它负责真正发信（例如用 QQ 邮箱的 SMTP + 授权码）。
   */
  emailRelayUrl: string;
  /** 邮件服务商 API Key（resend / brevo） */
  emailApiKey: string;
  /** 发件人地址：brevo 必须是你在服务商后台验证过的邮箱 */
  emailFrom: string;
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

  emailEnabled: false,
  emailTo: '',
  emailProvider: 'none',
  emailRelayUrl: '',
  emailApiKey: '',
  emailFrom: '',
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
