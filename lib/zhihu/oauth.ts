import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

// 知乎 OAuth 与用户数据 API 的服务端封装。整个模块只能在服务端引用：
// app_key、Access Secret、authorization_code 和 OAuth token 都不得进入前端响应、
// URL、日志或代码仓库（黑客松 OAuth 文档的安全边界）。
//
// 契约来源：skills/zhihu/references/hackathon-oauth.md 与 user-api.md。
// 黑客松项目以 hackathon-oauth.md 为事实源。

const AUTHORIZE_URL = "https://openapi.zhihu.com/authorize";
const TOKEN_URL = "https://openapi.zhihu.com/access_token";
const USER_API_BASE = "https://developer.zhihu.com";

/**
 * 用户资料端点。**路径与响应 schema 都没有写进官方文档**：
 * `hackathon.md` 承诺了「获取登录用户的昵称、头像等基础公开信息」，但 `oauth.md` 的
 * 协议待确认项 #5 原文承认「文档提到"获取用户信息"，但没有提供对应 endpoint 和响应
 * schema」，`user-api.md` 的接口目录里也没有它。唯一线索是 `oauth.md`「已验证偏差」
 * 一节提到存在一个 `/user` 端点（其业务字段 `code: 20000` 表示成功）。
 *
 * 所以这里按 `/api/v1/user`（`/api/v1/user/contents` 的父路径）猜一个，并且
 * `fetchUserProfile` 全程防御式解析：拿不到就当没有，绝不抛异常、绝不阻塞主链路。
 * 待 9/13 向主办方确认后收紧。
 */
export const USER_PROFILE_PATH = "/api/v1/user";

/** 单次会话最多翻几页创作列表。每页 50 条、串行请求，页数放太大会让调用方等到超时。 */
export const MAX_CONTENT_PAGES = 5;

export interface OAuthConfig {
  appId: string;
  appKey: string;
  redirectUri: string;
  accessSecret: string;
}

export type ConfigMissing =
  | "ZHIHU_OAUTH_APP_ID"
  | "ZHIHU_OAUTH_APP_KEY"
  | "ZHIHU_OAUTH_REDIRECT_URI"
  | "ZHIHU_ACCESS_SECRET";

export function readOAuthConfig(env: NodeJS.ProcessEnv = process.env): {
  config?: OAuthConfig;
  missing: ConfigMissing[];
} {
  const missing: ConfigMissing[] = [];
  if (!env.ZHIHU_OAUTH_APP_ID) missing.push("ZHIHU_OAUTH_APP_ID");
  if (!env.ZHIHU_OAUTH_APP_KEY) missing.push("ZHIHU_OAUTH_APP_KEY");
  if (!env.ZHIHU_OAUTH_REDIRECT_URI) missing.push("ZHIHU_OAUTH_REDIRECT_URI");
  if (!env.ZHIHU_ACCESS_SECRET) missing.push("ZHIHU_ACCESS_SECRET");
  if (missing.length) return { missing };
  return {
    config: {
      appId: env.ZHIHU_OAUTH_APP_ID!,
      appKey: env.ZHIHU_OAUTH_APP_KEY!,
      redirectUri: env.ZHIHU_OAUTH_REDIRECT_URI!,
      accessSecret: env.ZHIHU_ACCESS_SECRET!,
    },
    missing,
  };
}

/** 诊断只允许暴露来源、是否配置、长度和 SHA-256 短前缀，不展示完整值。 */
export function credentialFingerprint(value: string | undefined) {
  if (!value) return { configured: false, length: 0, sha256Prefix: "" };
  return {
    configured: true,
    length: value.length,
    sha256Prefix: createHash("sha256").update(value).digest("hex").slice(0, 8),
  };
}

export function publicConfigStatus(env: NodeJS.ProcessEnv = process.env) {
  const { config, missing } = readOAuthConfig(env);
  return {
    ready: missing.length === 0,
    missing,
    // redirect_uri 不是秘密，但要与活动页面登记值逐字符一致，所以回显给运维核对。
    redirectUri: env.ZHIHU_OAUTH_REDIRECT_URI || null,
    // 逐项独立取指纹：readOAuthConfig 缺任一项就不返回 config，
    // 若从这里读会把已配好的凭证也报成未配置，运维就看不出到底缺哪一个。
    appId: credentialFingerprint(env.ZHIHU_OAUTH_APP_ID),
    appKey: credentialFingerprint(env.ZHIHU_OAUTH_APP_KEY),
    accessSecret: credentialFingerprint(env.ZHIHU_ACCESS_SECRET),
    configured: config !== undefined,
  };
}

export function newState() {
  return randomBytes(24).toString("base64url");
}

export function newSessionId() {
  return randomBytes(24).toString("base64url");
}

export function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** 授权地址。`redirect_uri` 必须与活动页面登记值完全一致，包括协议、域名、路径和尾斜杠。 */
export function buildAuthorizeUrl(config: OAuthConfig, state: string) {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("app_id", config.appId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  return url.toString();
}

export interface OAuthToken {
  accessToken: string;
  expiresAt: number;
}

export class ZhihuAuthError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ZhihuAuthError";
  }
}

/**
 * 用授权码换 OAuth token。
 *
 * 表单字段名是 `code`（不是 `authorization_code`），`grant_type` 是固定值。
 * 判定成功以响应里是否存在 `access_token` 为准：业务响应可能带 `code: 20000`
 * 表示成功，不能只看那个字段就判失败。
 */
export async function exchangeCodeForToken(config: OAuthConfig, code: string): Promise<OAuthToken> {
  const body = new URLSearchParams({
    app_id: config.appId,
    app_key: config.appKey,
    grant_type: "authorization_code",
    redirect_uri: config.redirectUri,
    code,
  });

  let response: Response;
  try {
    response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
  } catch {
    // 不要把请求细节带进错误里：URL 上虽然没有秘密，但表单 body 含 app_key。
    throw new ZhihuAuthError("无法连接知乎授权服务，请检查网络后重试", 502);
  }

  const text = await response.text();
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new ZhihuAuthError(`知乎授权服务返回了非 JSON 响应（HTTP ${response.status}）`, 502);
  }

  const accessToken = typeof payload.access_token === "string" ? payload.access_token : "";
  if (!accessToken) {
    const described = describeFailure(payload);
    throw new ZhihuAuthError(described ?? `换取 token 失败（HTTP ${response.status}）`, 400);
  }

  const expiresIn = Number(payload.expires_in);
  // 文档没有承诺一定返回 expires_in；缺失时按 1 小时保守处理，过期就要求重新授权。
  const ttlSeconds = Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3600;
  return { accessToken, expiresAt: Date.now() + ttlSeconds * 1000 };
}

function describeFailure(payload: Record<string, unknown>): string | undefined {
  const candidates = ["error_description", "message", "Message", "error", "Error"];
  for (const key of candidates) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return `知乎授权失败：${value.trim()}`;
  }
  const code = payload.code ?? payload.Code;
  if (code !== undefined) return `知乎授权失败（code=${String(code)}）`;
  return undefined;
}

export interface ZhihuContentItem {
  contentType: string;
  url: string;
  createdAt: number;
  likeCount: number;
  commentCount: number;
  favoriteCount: number;
  title: string;
  summary: string;
}

export interface ZhihuContentPage {
  items: ZhihuContentItem[];
  isEnd: boolean;
  nextOffset: number | null;
  totals: number;
}

/**
 * 用户资料。字段名按服务端返回风格用 PascalCase，调用方（creator 构造）自己做降级映射。
 *
 * 三个字段都声明为必有：解析时只把**昵称**当硬性条件（没有昵称就没有可显示的作者名，
 * 直接返回 undefined），`Id` 退到 `UrlToken`、`UrlToken` 允许是空串，剩下的降级交给调用方。
 */
export interface ZhihuUserProfile {
  /** 用户唯一标识。 */
  Id: string;
  /** 昵称。 */
  Name: string;
  /** 主页标识（url_token），用于拼 handle。 */
  UrlToken: string;
  /** 一句话签名。非必需，拿不到就不显示。 */
  Headline?: string;
}

/** 所有用户数据接口共用同一套鉴权头：Access Secret 鉴权调用方，X-OAuth-Token 指明授权用户。 */
function userApiHeaders(config: OAuthConfig, token: OAuthToken) {
  return {
    authorization: `Bearer ${config.accessSecret}`,
    "x-oauth-token": token.accessToken,
    "x-request-timestamp": String(Math.floor(Date.now() / 1000)),
    "content-type": "application/json",
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function pickText(source: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    // 有的实现把 id 之类返回成数字，能安全转成字符串就接受。
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

/**
 * 从任意形态的响应里挑出用户资料。
 *
 * schema 未知，所以按「多候选容器 × 多候选字段名」逐个试；昵称拿不到就返回 undefined。
 * **不按 `Code` 判定成功**：用户数据接口用 `Code === 0`，而 `oauth.md` 记录 `/user` 的
 * 业务字段是 `code: 20000`，两套约定不一致，与其猜错把成功判成失败，不如只看字段本身
 * 能不能用——失败响应里不会长出一个昵称来。
 */
function pickUserProfile(payload: Record<string, unknown>): ZhihuUserProfile | undefined {
  const data = asRecord(payload.Data);
  const containers = [
    asRecord(data?.User),
    asRecord(data?.Profile),
    asRecord(data?.UserInfo),
    asRecord(payload.User),
    data,
    payload,
  ];
  for (const container of containers) {
    if (!container) continue;
    const name = pickText(container, ["Name", "name", "Nickname", "nickname", "DisplayName"]);
    if (!name) continue;
    const urlToken =
      pickText(container, ["UrlToken", "urlToken", "Url_token", "url_token", "Handle", "handle"]) ?? "";
    const id = pickText(container, ["Id", "id", "Uid", "uid", "UserId", "userId"]);
    return {
      Id: id ?? urlToken,
      Name: name,
      UrlToken: urlToken,
      Headline: pickText(container, ["Headline", "headline", "Description", "description"]),
    };
  }
  return undefined;
}

/**
 * 读取授权用户的基础公开信息。
 *
 * **未确认端点**（见 `USER_PROFILE_PATH`）：任何异常都吞掉并返回 undefined，包括网络失败、
 * 非 JSON 响应、鉴权失败、字段缺失或类型不符。调用方只想要「有就用真名，没有就降级到
 * 合成 creator」这一个语义，不该为了昵称把整条登录/编译链路拦下来。
 */
export async function fetchUserProfile(
  config: OAuthConfig,
  token: OAuthToken,
): Promise<ZhihuUserProfile | undefined> {
  try {
    if (Date.now() >= token.expiresAt) return undefined;
    const response = await fetch(new URL(USER_PROFILE_PATH, USER_API_BASE), {
      headers: userApiHeaders(config, token),
    });
    return pickUserProfile((await response.json()) as Record<string, unknown>);
  } catch {
    return undefined;
  }
}

/**
 * 文档明确：请求的 `Offset` 是 Int64，响应的 `NextOffset` 却是 String。
 * 严格解析——解析不出整数就当到底了，绝不静默截断成 0，那会让分页原地打转。
 * 分页调用方共用这一份判定，不存在第二个宽松版本。
 */
export function strictNextOffset(paging: Record<string, unknown>): number | null {
  if (paging.IsEnd === false && paging.NextOffset != null) {
    const parsed = Number(paging.NextOffset);
    if (Number.isInteger(parsed)) return parsed;
  }
  return null;
}

const ERROR_MESSAGES: Record<number, string> = {
  10001: "请求参数错误",
  20001: "鉴权失败，请重新连接知乎账号",
  30001: "触发频率限制，请稍后再试",
  30002: "开放平台额度已用尽",
  90001: "知乎服务内部错误",
};

/**
 * 代表已授权用户读取其公开创作。
 *
 * Access Secret 鉴权调用方（每次请求都要带），`X-OAuth-Token` 指明当前授权用户。
 * App Key 不能作为其中任何一个 header。token 过期或鉴权失败时直接抛错，
 * **不回退到 Access Secret 所属账号**——那会把调用方自己的创作冒充成用户的。
 */
export async function fetchUserContents(
  config: OAuthConfig,
  token: OAuthToken,
  options: { contentType?: string; limit?: number; offset?: number } = {},
): Promise<ZhihuContentPage> {
  if (Date.now() >= token.expiresAt) {
    throw new ZhihuAuthError("知乎授权已过期，请重新连接账号", 401);
  }

  const url = new URL(`${USER_API_BASE}/api/v1/user/contents`);
  // 默认 all 而不是 article：知乎语境下「我的创作」里回答通常多于文章，
  // 只取 article 会白白丢掉大量证据。合法值见 doc：all/answer/article/zvideo/pin/question。
  url.searchParams.set("ContentType", options.contentType ?? "all");
  url.searchParams.set("Limit", String(Math.min(options.limit ?? 50, 50)));
  url.searchParams.set("Offset", String(options.offset ?? 0));
  url.searchParams.set("SortField", "ts");
  url.searchParams.set("SortOrder", "desc");

  const response = await fetch(url, { headers: userApiHeaders(config, token) });

  let payload: { Code?: number; Message?: string; Data?: Record<string, unknown> };
  try {
    payload = await response.json() as typeof payload;
  } catch {
    throw new ZhihuAuthError(`知乎用户数据接口返回了非 JSON 响应（HTTP ${response.status}）`, 502);
  }

  if (payload.Code !== 0) {
    const known = payload.Code !== undefined ? ERROR_MESSAGES[payload.Code] : undefined;
    throw new ZhihuAuthError(
      known ?? `读取知乎创作失败（HTTP ${response.status}${payload.Message ? `：${payload.Message}` : ""}）`,
      payload.Code === 20001 ? 401 : 502,
    );
  }

  const data = payload.Data ?? {};
  const rawItems = Array.isArray(data.Items) ? data.Items as Record<string, unknown>[] : [];
  const paging = (data.Paging ?? {}) as Record<string, unknown>;

  return {
    items: rawItems.map((item) => ({
      contentType: String(item.ContentType ?? ""),
      url: String(item.Url ?? ""),
      createdAt: Number(item.CreatedAt ?? 0),
      likeCount: Number(item.LikeCount ?? 0),
      commentCount: Number(item.CommentCount ?? 0),
      favoriteCount: Number(item.FavoriteCount ?? 0),
      title: String(item.Title ?? ""),
      summary: String(item.Summary ?? ""),
    })),
    isEnd: paging.IsEnd !== false,
    nextOffset: strictNextOffset(paging),
    totals: Number(paging.Totals ?? rawItems.length),
  };
}

/**
 * 串行翻页聚合全部创作（最多 `maxPages` 页，每页 50 条），按 url 去重。
 *
 * 分页判定直接复用 `fetchUserContents` 的 `strictNextOffset`：`NextOffset` 解析不出来
 * 就当到底，不给「静默变成 0 原地打转」留口子。
 *
 * 出错直接抛（ZhihuAuthError），由调用方决定是吞掉（预热）还是报给用户（按需补齐）。
 * 不做「部分成功」返回——半个语料编译出来的图谱比失败更难解释。
 */
export async function fetchAllUserContents(
  config: OAuthConfig,
  token: OAuthToken,
  maxPages: number = MAX_CONTENT_PAGES,
): Promise<ZhihuContentItem[]> {
  const collected: ZhihuContentItem[] = [];
  const known = new Set<string>();
  let offset = 0;

  for (let page = 0; page < Math.max(1, maxPages); page += 1) {
    const result = await fetchUserContents(config, token, { limit: 50, offset });
    for (const item of result.items) {
      if (known.has(item.url)) continue;
      known.add(item.url);
      collected.push(item);
    }
    if (result.isEnd || result.nextOffset === null) break;
    offset = result.nextOffset;
  }

  return collected;
}
