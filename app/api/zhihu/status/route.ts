import type { NextRequest } from "next/server";
import { publicConfigStatus } from "@/lib/zhihu/oauth";
import { getSession, SESSION_COOKIE } from "@/lib/zhihu/session";

export const runtime = "nodejs";

/**
 * 登录页唯一需要的状态。返回里没有任何凭证值：只有是否配置、长度和 SHA-256 短前缀，
 * 以及会话还剩多久过期。前端不得读取 OAuth token。
 */
export async function GET(request: NextRequest) {
  const status = publicConfigStatus();
  const session = getSession(request.cookies.get(SESSION_COOKIE)?.value);
  const origin = new URL(request.url).origin;

  // redirect_uri 必须与活动页面登记值逐字符一致。本机调试时当前 origin 往往对不上，
  // 这一项直接告诉使用者为什么授权跳转会被知乎拒绝，而不是让他猜。
  const redirectOrigin = status.redirectUri ? new URL(status.redirectUri).origin : null;

  return Response.json({
    ...status,
    origin,
    redirectOrigin,
    originMatchesRedirect: redirectOrigin !== null && redirectOrigin === origin,
    connected: Boolean(session),
    sessionExpiresInSec: session ? Math.max(0, Math.round((session.token.expiresAt - Date.now()) / 1000)) : 0,
    importedCount: session?.imported.length ?? 0,
    contentsCount: session?.contents.length ?? 0,
    hasDataset: Boolean(session?.dataset),
  });
}
