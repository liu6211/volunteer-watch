/** account.mjs 的类型声明 */

export interface AccountSessionState {
  cookie: string;
  seid: string;
}

export interface MyProject {
  name: string;
  url: string;
  org: string;
  joinedAt: string;
  status: string;
  post: string;
  hours: string;
}

export interface MyOrg {
  name: string;
  url: string;
  area: string;
  contact: string;
  joinedAt: string;
  status: string;
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
export function parseMyOrgs(html: string): { items: MyOrg[] };
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
