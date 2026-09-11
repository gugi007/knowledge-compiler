import { NextResponse, type NextRequest } from "next/server";
import { exchangeCodeForToken, readOAuthConfig, safeEqual, ZhihuAuthError } from "@/lib/zhihu/oauth";
import {
  consumePendingState,
  createSession,
  SESSION_COOKIE,
  sessionCookieOptions,
  STATE_COOKIE,
  warmSession,
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

  // 预热（用户资料 + 全部创作）只为让 /api/compile 走「零上游调用」的快路径，
  // 所以 fire-and-forget：不 await、不阻塞回跳。warmSession 自己吞掉所有失败，
  // 这里再挂一个 catch 只是为了任何情况下都不可能冒出一个未处理的 rejection。
  void warmSession(sessionId).catch(() => {});

  // frontend-v2 冻结的成功回跳：直达第二幕。语料由服务端按需补齐，
  // 所以这里不需要用户先手动导入文章。
  const response = NextResponse.redirect(new URL("/compile?corpus=imported", request.url));
  response.cookies.set({ name: SESSION_COOKIE, value: sessionId, ...sessionCookieOptions() });
  response.cookies.delete(STATE_COOKIE);
  return response;
}
