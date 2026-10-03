/** search.mjs 的类型声明 */

export interface OrgSearchItem {
  /** 列表页给出的加密 id（用于本次打开团体页） */
  linkId: string;
  /** 团体名称 */
  name: string;
  /** 团体人数，取不到为 null */
  members: number | null;
  /** 该团完整链接（用 linkId） */
  url: string;
}

export interface OrgSearchResult {
  items: OrgSearchItem[];
  total: number | null;
  totalPages: number | null;
}

export function searchUrl(
  host: string,
  keyword: string,
  opts?: { page?: number; area?: string }
): string;

export function parseOrgList(html: string, host?: string): OrgSearchResult;

export function searchOrgs(
  host: string,
  keyword: string,
  opts?: { page?: number; area?: string; timeoutMs?: number; fetchImpl?: typeof fetch }
): Promise<OrgSearchResult>;

export function resolveStableOrgId(
  host: string,
  linkId: string,
  opts?: { timeoutMs?: number; fetchImpl?: typeof fetch }
): Promise<{ stableId: string | null; url: string }>;

/** 固定使用的搜索站点（贵州站） */
export const SEARCH_HOST: string;

/** 贵州站下属的属地筛选 */
export const GUIZHOU_AREAS: { code: string; label: string }[];
