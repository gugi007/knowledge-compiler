import { ConceptsPage } from "@/app/login/concepts-page";

/**
 * 「概念说明」独立页路由壳（/concepts，ROUTES.concepts）。
 *
 * 第一幕附属内容页：实现全部在 app/login/concepts-page.tsx（login-agent
 * ownership），这里只做转交——与 app/page.tsx 转交 LoginScreen 同一惯例。
 *
 * 纯静态 server component，由根 layout（app/layout.tsx）统一包裹；
 * 各 page.tsx 均无导出 metadata 的惯例（仅根 layout 有），本壳保持一致不加。
 */
export default function ConceptsRoute() {
  return <ConceptsPage />;
}
