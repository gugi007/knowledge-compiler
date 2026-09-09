import { NextResponse, type NextRequest } from "next/server";
import { exchangeCodeForToken, readOAuthConfig, safeEqual, ZhihuAuthError } from "@/lib/zhihu/oauth";
import {
  consumePendingState,
  createSession,
  SESSION_COOKIE,
  sessionCookieOptions,
  STATE_COOKIE,
} from "@/lib/zhihu/session";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  // frontend-v2 冻结的回跳规则：失败一律 /?authError=<原因>，不再回旧 /connect 页。
  const back = (reason: string) => {
    const url = new URL("/", request.url);
    url.searchParams.set("authError", reason);
    return NextResponse.redirect(url);
  };

  const params = new URL(request.url).searchParams;
  // 黑客松实测主回调参数是 authorization_code，兼容读取 code。
  const code = params.get("authorization_code") ?? params.get("code") ?? "";
  // 回调没有授权码就停止流程，不继续换取 token。
  if (!code) return back(params.get("error") ? `denied:${params.get("error")}` : "no-code");

  const { config } = readOAuthConfig();
  if (!config) return back("missing-config");

  const cookieState = request.cookies.get(STATE_COOKIE)?.value ?? "";
  const returnedState = params.get("state") ?? "";
  if (!cookieState) return back("state-missing");
  // 文档只承诺回调带 authorization_code，没承诺回显 state，所以回调带了就严格比对，
  // 没带就退化为「cookie 里的 state 必须存在且只能用一次」。
  if (returnedState && !safeEqual(cookieState, returnedState)) return back("state-mismatch");
  if (!consumePendingState(cookieState)) return back("state-expired");

  let token;
  try {
    token = await exchangeCodeForToken(config, code);
  } catch (error) {
    return back(error instanceof ZhihuAuthError ? `exchange:${error.message}` : "exchange-failed");
  }

  const sessionId = createSession(token);
  // frontend-v2 冻结的成功回跳：回第一幕 /，用 auth=connected 告知登录页。
  const response = NextResponse.redirect(new URL("/?auth=connected", request.url));
  response.cookies.set({ name: SESSION_COOKIE, value: sessionId, ...sessionCookieOptions() });
  response.cookies.delete(STATE_COOKIE);
  return response;
}
