import { NextResponse, type NextRequest } from "next/server";
import { buildAuthorizeUrl, readOAuthConfig } from "@/lib/zhihu/oauth";
import {
  createPendingState,
  sessionCookieOptions,
  STATE_COOKIE,
} from "@/lib/zhihu/session";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  // frontend-v2 冻结的失败回跳：/ 带 authError，不再回旧 /connect 页。
  const back = (reason: string) => {
    const url = new URL("/", request.url);
    url.searchParams.set("authError", reason);
    return NextResponse.redirect(url);
  };

  const { config, missing } = readOAuthConfig();
  if (!config) return back(`missing-config:${missing.join(",")}`);

  const state = createPendingState();
  const response = NextResponse.redirect(buildAuthorizeUrl(config, state));
  response.cookies.set({
    name: STATE_COOKIE,
    value: state,
    ...sessionCookieOptions(),
    maxAge: 600,
  });
  return response;
}
