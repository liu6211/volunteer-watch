/** account.mjs 的类型声明 */

export interface AccountSessionState {
  cookie: string;
  seid: string;
  /** 哪种 Cookie 模式生效：platform（交给运行环境） / manual（自己带 Cookie 头） */
  cookieMode?: string;
}

export interface MyProjectAction {
  /** 站点 onclick 里的函数名，如 del_opp_vol */
  fn: string;
  /** 函数参数，第一个通常是报名记录编号 */
  args: string[];
  /** 按钮文字，如「删除」「更换岗位」 */
  label: string;
}

export interface MyProject {
  name: string;
  url: string;
  org: string;
  joinedAt: string;
  status: string;
  post: string;
  hours: string;
  /** 报名记录编号（onclick 的第一个参数） */
  oppId: string;
  /** 该行可用的操作 */
  actions: MyProjectAction[];
}

export interface MyOrg {
  name: string;
  url: string;
  area: string;
  contact: string;
  joinedAt: string;
  status: string;
  /** 团体编号（onclick 的第一个参数） */
  orgId: string;
  actions: MyProjectAction[];
}

export interface MyHour {
  hours: number;
  note: string;
  status: string;
  addedBy: string;
  project: string;
  projectUrl: string;
  org: string;
  date: string;
}

export interface MyHoursResult {
  items: MyHour[];
  total: number | null;
  effective: number | null;
}

export interface LoginResult {
  ok: boolean;
  needCaptcha?: boolean;
  message: string;
}

export const SITE_PUBKEY: string;

export const ACCOUNT_PATHS: {
  projects: string;
  orgs: string;
  hours: string;
};

export function createSession(): AccountSessionState;

export function checkNeedCaptcha(
  session: AccountSessionState,
  host: string,
  username: string,
  opts?: { fetchImpl?: typeof fetch }
): Promise<{ needCaptcha: boolean; message: string }>;

export function login(
  session: AccountSessionState,
  host: string,
  username: string,
  password: string,
  captcha?: string
): Promise<LoginResult>;

export function logout(session: AccountSessionState, host: string): Promise<void>;

export interface AccountFeature {
  key: string;
  title: string;
  path: string;
  kind: 'card' | 'pdf' | 'table';
  desc: string;
  icon: string;
}

export const ACCOUNT_FEATURES: AccountFeature[];

export function featureByKey(key: string): AccountFeature | null;

export function parseGenericTable(html: string): { headers: string[]; rows: string[][] };

export function fetchGenericPage(
  session: AccountSessionState,
  host: string,
  path: string
): Promise<{ headers: string[]; rows: string[][] }>;

export function parseCardImages(html: string, host: string): string[];

export function fetchCard(
  session: AccountSessionState,
  host: string
): Promise<{ images: string[] }>;

export function certUrl(host: string): string;

export function parseMyProjects(html: string): { items: MyProject[] };

/**
 * 取消报名（站点里叫「删除」）。
 * 会用「重新拉一次我的项目」验证真实结果，不轻信服务器文案。
 */
export function cancelApplication(
  session: AccountSessionState,
  host: string,
  oppId: string,
  type?: string,
  opts?: { fetchImpl?: typeof fetch; timeoutMs?: number }
): Promise<{ ok: boolean; message: string }>;
/** 查可选岗位（更换岗位前要先拿到岗位列表） */
export function fetchJobOptions(
  session: AccountSessionState,
  host: string,
  oppId: string,
  opts?: { fetchImpl?: typeof fetch; timeoutMs?: number }
): Promise<{ oppName: string; jobs: { id: string; name: string }[] }>;

/** 提交更换岗位 */
export function changeJob(
  session: AccountSessionState,
  host: string,
  oppId: string,
  groupId: string,
  opts?: { fetchImpl?: typeof fetch; timeoutMs?: number }
): Promise<{ ok: boolean; message: string }>;

/** 申请服务时长 */
export function applyHour(
  session: AccountSessionState,
  host: string,
  oppId: string,
  hourNum: string | number,
  memo: string,
  opts?: { fetchImpl?: typeof fetch; timeoutMs?: number }
): Promise<{ ok: boolean; message: string }>;

/** 评价项目 */
export function submitScore(
  session: AccountSessionState,
  host: string,
  oppId: string,
  scoreId: string,
  scores: number[],
  content: string,
  opts?: { fetchImpl?: typeof fetch; timeoutMs?: number }
): Promise<{ ok: boolean; message: string }>;

export function parseMyOrgs(html: string): { items: MyOrg[] };

/** 退出团体 / 删除申请（会重新拉列表验证真实结果，不轻信文案） */
export function leaveOrg(
  session: AccountSessionState,
  host: string,
  orgId: string,
  status?: string,
  opts?: { fetchImpl?: typeof fetch; timeoutMs?: number }
): Promise<{ ok: boolean; message: string }>;

/** 项目详情页的其它标签 */
export const OPP_TABS: Record<string, { action: string; label: string }>;

/** 项目的讨论区 / 项目动态 / 时长公示 */
export interface OppTabItem {
  /** 作者（讨论区/动态有） */
  author: string;
  /** 时间 */
  time: string;
  /** 正文 */
  content: string;
}

export function fetchOppTab(
  session: AccountSessionState | null,
  host: string,
  tab: 'comment' | 'track' | 'hour',
  id: string,
  page?: number,
  opts?: { commentType?: string; fetchImpl?: typeof fetch; timeoutMs?: number }
): Promise<{ items: OppTabItem[]; lines: string[]; empty: boolean }>;
export function parseMyHours(html: string): MyHoursResult;

export function checkSession(
  session: AccountSessionState,
  host: string
): Promise<{ ok: boolean }>;

export function fetchMyProjects(
  session: AccountSessionState,
  host: string
): Promise<{ items: MyProject[] }>;

export function fetchMyOrgs(
  session: AccountSessionState,
  host: string
): Promise<{ items: MyOrg[] }>;

export function fetchMyHours(
  session: AccountSessionState,
  host: string
): Promise<MyHoursResult>;
