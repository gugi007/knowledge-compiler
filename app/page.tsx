import { LoginScreen } from "./login/login-screen";

/**
 * 第一幕挂在站点根路径。
 *
 * 实现全部在 app/login/** 里，这里只做转交——这样 login-agent 的写入范围
 * 仍然是 AGENTS.md 写明的 `app/login/**`，不必碰这个根 page。
 *
 * 旧的三栏阅读视图（app/knowledge-garden.tsx）原来挂在这里，
 * 现已移到 /legacy，文件本身未改动，仅作参考保留。
 */
export default function Home() {
  return <LoginScreen />;
}
