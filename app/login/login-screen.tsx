import Link from "next/link";
import { PageShell } from "@/app/_shared/ui/page-shell";
import { CORPORA } from "@/lib/frontend/corpora";
import { ROUTES } from "@/lib/frontend/routes";
import { LoginConnector } from "./login-connector";
import { PromiseBar } from "./promise-bar";

/**
 * 第一幕：登录 / 承诺。
 *
 * OWNER: login-agent（此文件与本目录下所有内容）
 *
 * 承诺文案保留为 server component，不进客户端 bundle。交互部分
 * （状态机、OAuth 跳转、授权失败提示、演示退路）拆到 LoginConnector，
 * 由它单独 "use client"。
 *
 * 导航一律走 ROUTES 常量；OAuth 跳转是 API 路由不是页面路由，用直连 href。
 */
export function LoginScreen() {
  return (
    <PageShell eyebrow="Act 1 · 登录">
      <section className="hero-gradient hero-in panel mt-6 px-6 py-14 text-center md:px-10 md:py-20">
        <p className="eyebrow">Article Timeline → Knowledge Network</p>
        <h1 className="mx-auto mt-4 max-w-3xl font-display text-4xl leading-tight font-semibold tracking-tight md:text-6xl">
          登录知乎，
          <br />
          编译你的知识宇宙
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-sm leading-7 text-ink/60">
          把多年创作，编译成一张持续生长的知识网络。
        </p>

        {/* 主动作与状态机交给客户端组件：查 status、跳 OAuth、演示退路 */}
        <LoginConnector />

        {/* 演示退路：不登录也能先看空间。三个 agent 并行开发时这条路保证演示不断链。 */}
        <p className="mt-8 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-sm">
          {CORPORA.map((corpus) => (
            <Link
              className="tag font-bold"
              href={`${ROUTES.space}?source=${corpus.id}`}
              key={corpus.id}
            >
              先探索「{corpus.label}」→
            </Link>
          ))}
        </p>

        <p className="mx-auto mt-8 max-w-lg text-[11px] leading-5 text-ink/40">
          只读取你公开范围的创作数据 · 不复制内容，只编译观点 ·
          数据仅用于编译你的知识空间，可随时断开授权
        </p>
      </section>

      {/* 承诺条：把「连接 → 编译 → 探索」的价值链显性化，强化品牌认知。
          文案与视觉收口在 PromiseBar（server component），这里只挂载。 */}
      <PromiseBar />
    </PageShell>
  );
}
