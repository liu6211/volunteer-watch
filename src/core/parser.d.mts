/**
 * parser.mjs 的类型声明（TS 会自动匹配同名的 .d.mts）
 */

export interface OppItem {
  /**
   * 项目链接里的 id。
   * ⚠️ 实测：这个 id 是会话级加密的，每次请求都不同，**不能用于去重**。
   * 只用来在浏览器里打开项目详情。
   */
  id: string;
  /** 去重指纹（名称+日期+状态），这才是稳定的判断依据 */
  fingerprint: string;
  /** 项目名称 */
  name: string;
  /** 发布日期，如 2026-10-01 */
  date: string;
  /** 项目状态，如 运行中 */
  status: string;
  /** 项目详情链接 */
  url: string;
}

/** 指纹计数表：fingerprint -> 条数 */
export type CountTable = Record<string, number>;

export interface OrgSnapshot {
  /** 团体数字编号，如 6385777（来自 org_join），拿不到时为空串 */
  orgId: string;
  /** 团体名称 */
  orgName: string;
  /** 项目列表 */
  projects: OppItem[];
  /** 项目链接 id（不稳定，仅供调试） */
  projectIds: string[];
  /** 指纹计数表，下次检查用来比较 */
  counts: CountTable;
  /** 抓取时间 ISO */
  fetchedAt: string;
}

export type NewReason = 'new-id' | 'new-date';

export interface NewProjectHit {
  item: OppItem;
  reason: NewReason;
}

export function detectCharset(contentType: string | null, bytes: Uint8Array): string;
export function decodeHtml(bytes: Uint8Array, charset: string): string;
export function decodeEntities(s: string): string;
export function validateOrgPage(html: string): { ok: boolean; reason?: string };
export function parseOrgPage(html: string, opts?: { host?: string }): OrgSnapshot;
export function parseOrgName(html: string): string;
export function parseOrgId(html: string): string;
export function parseProjects(html: string, host?: string): OppItem[];

export function fetchOrgSnapshot(
  url: string,
  opts?: { host?: string; timeoutMs?: number; fetchImpl?: typeof fetch }
): Promise<OrgSnapshot>;

export function findNewProjects(
  current: OppItem[],
  seenCounts: CountTable
): NewProjectHit[];

export function parseLooseDate(s: string): number;

export function buildNotificationText(
  orgName: string,
  items: OppItem[]
): { title: string; body: string };

export {
  fingerprintOf,
  toCounts,
  findNewByCounts,
  pruneCounts,
} from './fingerprint.mjs';
export type { NewReason as NewByCountsReason, NewProjectHit as NewByCountsHit } from './fingerprint.mjs';
