import type { CompiledKnowledgeDataset, RawArticle } from "@/data/models";
// profile 只用类型（不会在运行时读），用 import type 引，避免 session ↔ oauth 之间
// 出现运行时循环依赖。
import type { OAuthToken, ZhihuContentItem, ZhihuUserProfile } from "./oauth.ts";
import {
  fetchAllUserContents,
  fetchUserProfile,
  MAX_CONTENT_PAGES,
  newSessionId,
  newState,
  readOAuthConfig,
} from "./oauth.ts";

// OAuth token、授权码和导入结果只存在服务端进程内存里，不落盘、不进浏览器存储、
// 不进日志。浏览器只拿到一个 httpOnly 的会话 id。
//
// 局限（演示可接受，上线前要换）：状态是单进程内存，应用重启或多实例部署都会丢，
// `next dev` 的热重载也会清掉。黑客松 OAuth 文档要求「应用重启或测试结束时清理
// 服务端 OAuth 会话」，内存实现天然满足这一条，但持久化前需要先做安全评审。

export const SESSION_COOKIE = "kc_zhihu_session";
export const STATE_COOKIE = "kc_zhihu_oauth_state";

const STATE_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 60 * 60 * 1000;

interface PendingState {
  expiresAt: number;
}

export interface ZhihuSession {
  token: OAuthToken;
  connectedAt: number;
  /** 授权用户的基础公开信息。未确认端点拿不到时为 undefined，creator 走合成值降级。 */
  profile?: ZhihuUserProfile;
  contents: ZhihuContentItem[];
  contentsFetchedAt?: number;
  imported: RawArticle[];
  importedAt?: number;
  dataset?: CompiledKnowledgeDataset;
  compiledAt?: number;
}

const pendingStates = new Map<string, PendingState>();
const sessions = new Map<string, ZhihuSession>();

function sweep<T extends { expiresAt: number }>(map: Map<string, T>, now: number) {
  for (const [key, value] of map) {
    if (value.expiresAt <= now) map.delete(key);
  }
}

export function createPendingState(): string {
  const now = Date.now();
  sweep(pendingStates, now);
  const state = newState();
  pendingStates.set(state, { expiresAt: now + STATE_TTL_MS });
  return state;
}

/** state 一次性消费：回调校验后立即删除，重放同一个 state 会失败。 */
export function consumePendingState(state: string): boolean {
  const now = Date.now();
  sweep(pendingStates, now);
  const pending = pendingStates.get(state);
  if (!pending) return false;
  pendingStates.delete(state);
  return pending.expiresAt > now;
}

export function createSession(token: OAuthToken): string {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (session.token.expiresAt <= now || now - session.connectedAt > SESSION_TTL_MS) sessions.delete(id);
  }
  const id = newSessionId();
  sessions.set(id, { token, connectedAt: now, contents: [], imported: [] });
  return id;
}

export function getSession(id: string | undefined): ZhihuSession | undefined {
  if (!id) return undefined;
  const session = sessions.get(id);
  if (!session) return undefined;
  const now = Date.now();
  if (session.token.expiresAt <= now || now - session.connectedAt > SESSION_TTL_MS) {
    sessions.delete(id);
    return undefined;
  }
  return session;
}

export function destroySession(id: string | undefined) {
  if (id) sessions.delete(id);
}

/**
 * 按 url 去重合并创作条目，返回新增条数，并记录抓取时间。
 * 导入面板的分页请求与登录预热共用这一份口径，避免「哪些算重复」有两套判断。
 */
export function pushContents(session: ZhihuSession, items: readonly ZhihuContentItem[]): number {
  const known = new Set(session.contents.map((item) => item.url));
  let added = 0;
  for (const item of items) {
    if (known.has(item.url)) continue;
    known.add(item.url);
    session.contents.push(item);
    added += 1;
  }
  // 调用它就意味着「这一轮确实抓过」：抓到 0 条也刷新时间戳（前端据此显示抓取时间），
  // 而抓失败的调用方不应该调用它。
  session.contentsFetchedAt = Date.now();
  return added;
}

/**
 * 登录后预热：拉授权用户资料 + 全部创作（最多 `maxPages` 页）写回会话。
 *
 * 预热是**优化**不是必经路径——它让 `/api/compile` 的 imported 语料走「零上游调用」的
 * 快路径。因此这里任何失败都必须被吞掉：不抛异常，不把 session 置成错误态，更不能因此
 * 把用户堵在登录门外。预热没赶上时 `/api/compile` 会自然重试（见 route.ts 的慢路径）。
 */
export async function warmSession(
  sessionId: string,
  maxPages: number = MAX_CONTENT_PAGES,
): Promise<void> {
  try {
    const session = sessions.get(sessionId);
    if (!session) return;
    const { config } = readOAuthConfig();
    if (!config) return;

    // 两件事互不依赖，各自消化自己的失败：profile 拿不到不影响创作列表，反之亦然。
    const [profile, contents] = await Promise.all([
      fetchUserProfile(config, session.token).catch(() => undefined),
      // 抓失败用 null 区分于「抓到 0 条」：失败不该盖 contentsFetchedAt。
      fetchAllUserContents(config, session.token, maxPages).catch(() => null),
    ]);

    // 预热期间会话可能已过期、被登出或被 sweep 掉，写回前重新确认它还在。
    const current = sessions.get(sessionId);
    if (!current || current !== session) return;
    if (profile) current.profile = profile;
    if (contents) pushContents(current, contents);
  } catch {
    // 静默：预热失败只是退化回慢路径。
  }
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
    // 本机 http 调试时不能加 secure，否则浏览器直接丢弃 cookie；公网必须是 https。
    secure: process.env.NODE_ENV === "production",
  };
}
