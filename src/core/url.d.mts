/**
 * url.mjs 的类型声明（TS 会自动匹配同名的 .d.mts）
 */

export interface OrgTarget {
  id: string;
  host: string;
  url: string;
}

export const DEFAULT_HOST: string;
export const KNOWN_SUBDOMAINS: string[];

export function normalizeOrgInput(input: string): OrgTarget;
export function orgViewUrl(host: string, id: string): string;
export function oppViewUrl(host: string, oppId: string): string;
export function siteLabel(host: string): string;
