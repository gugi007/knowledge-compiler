/**
 * 三幕流程的路由常量。三个 feature agent 都要互相跳转，把字面量集中在这里，
 * 免得各自硬编码后对不上。
 *
 * 第一幕 登录/承诺  → "/"        （app/page.tsx 转交 app/login/**）
 * 概念说明页        → "/concepts"（第一幕附属内容页，内容组件在 app/login/concepts-page.tsx）
 * 第二幕 编译台      → "/compile" （app/compile/**）
 * 第三幕 知识空间    → "/space"   （app/space/**）
 *
 * LEGACY 是旧的三栏阅读视图（app/knowledge-garden.tsx），只作参考实现保留，
 * 不参与 v2 流程，也不要在 v2 页面里链过去。
 */
export const ROUTES = {
  login: "/",
  concepts: "/concepts",
  compile: "/compile",
  space: "/space",
  legacy: "/legacy",
} as const;

export type RouteKey = keyof typeof ROUTES;
