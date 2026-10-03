/** project.mjs 的类型声明 */

export interface OppPost {
  index: number;
  title: string;
  plan: number | null;
  joined: number | null;
  jobId: string;
  desc: string;
  condition: string;
}

export interface OppDetail {
  title: string;
  oppId: string;
  info: {
    place: string;
    category: string;
    target: string;
    recruitStart: string;
    recruitEnd: string;
    projectDate: string;
    publishedAt: string;
    serviceTime: string;
    guarantee: string;
  };
  posts: OppPost[];
  canJoin: boolean;
  joinedAlready: boolean;
  detail: string;
  joiners: { name: string; post: string; date: string }[];
  url: string;
}

export function parseProject(html: string, host?: string): OppDetail;

export function fetchProject(
  host: string,
  oppId: string,
  opts?: { fetchImpl?: typeof fetch; timeoutMs?: number }
): Promise<OppDetail>;

export function joinProject(
  session: { cookie: string; seid: string; cookieMode?: string },
  host: string,
  oppId: string,
  jobId: string,
  opts?: { oppPwd?: string; answer?: string; fetchImpl?: typeof fetch; timeoutMs?: number }
): Promise<{ ok: boolean; message: string }>;
