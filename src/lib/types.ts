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

/** 应用设置 */
export interface AppSettings {
  /** 是否开启通知 */
  notificationsEnabled: boolean;
  /** 后台检查最小间隔（分钟），Android 最小 15 */
  intervalMinutes: number;
  /** 是否启用后台定时检查 */
  backgroundCheckEnabled: boolean;
  /** 邮箱通知开关（默认关闭，需要用户填 SMTP 才生效） */
  emailEnabled: boolean;
  emailTo: string;
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
  intervalMinutes: 60,
  backgroundCheckEnabled: true,
  emailEnabled: false,
  emailTo: '',
};

export const EMPTY_STATE: AppState = {
  version: 1,
  watches: [],
  notifications: [],
  settings: DEFAULT_SETTINGS,
};
