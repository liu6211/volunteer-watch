/**
 * 全局数据类型定义
 */
import type { OppItem, CountTable } from '../core/parser.mjs';
export type { OppItem };

/** 被监控的团体 */
export interface WatchItem {
  /** 团体 id（如 Vl6t7DSgAHI3O），同时作为主键 */
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

/** 邮件发送通道 */
export type EmailProvider = 'none' | 'relay' | 'resend' | 'brevo';

/** 应用设置 */
export interface AppSettings {
  /** 是否开启通知 */
  notificationsEnabled: boolean;
  /** 检查间隔（分钟），Android 后台最小 15 */
  intervalMinutes: number;
  /** 是否启用定时自动检查 */
  backgroundCheckEnabled: boolean;

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

/** 整个应用的持久化状态 */
export interface AppState {
  version: number;
  watches: WatchItem[];
  notifications: StoredNotification[];
  settings: AppSettings;
}

export const DEFAULT_SETTINGS: AppSettings = {
  notificationsEnabled: true,
  intervalMinutes: 15,
  backgroundCheckEnabled: true,

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
};
