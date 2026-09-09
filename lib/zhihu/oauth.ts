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
  url.searchParams.set("ContentType", options.contentType ?? "article");
  url.searchParams.set("Limit", String(Math.min(options.limit ?? 50, 50)));
  url.searchParams.set("Offset", String(options.offset ?? 0));
  url.searchParams.set("SortField", "ts");
  url.searchParams.set("SortOrder", "desc");

  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${config.accessSecret}`,
      "x-oauth-token": token.accessToken,
      "x-request-timestamp": String(Math.floor(Date.now() / 1000)),
      "content-type": "application/json",
    },
  });

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

  // 文档明确：请求的 Offset 是 Int64，响应的 NextOffset 却是 String。
  // 严格解析，解析不出来就当到底了，不静默截断成 0 造成死循环。
  let nextOffset: number | null = null;
  if (paging.IsEnd === false && paging.NextOffset != null) {
    const parsed = Number(paging.NextOffset);
    nextOffset = Number.isInteger(parsed) ? parsed : null;
  }

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
    nextOffset,
    totals: Number(paging.Totals ?? rawItems.length),
  };
}
