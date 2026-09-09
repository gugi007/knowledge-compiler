import Link from "next/link";
import { PageShell } from "@/app/_shared/ui/page-shell";
import { ScaffoldNotice } from "@/app/_shared/ui/scaffold-notice";
import { CORPORA } from "@/lib/frontend/corpora";
import { ROUTES } from "@/lib/frontend/routes";

/**
 * 第一幕：登录 / 承诺。
 *
 * OWNER: login-agent（此文件与本目录下所有内容）
 *
 * 现在是骨架：只有承诺文案、主动作壳子、演示退路。
 * 登录按钮尚未接知乎 OAuth——本分支没有 app/api/auth/** 路由，
 * 接入前需要 login-agent 提 CCR 请 compiler-core-agent 加回调路由。
 *
 * 骨架保留为 server component。login-agent 若要加交互状态
 * （跳转中置灰、授权失败提示），把交互部分拆成子组件加 "use client"，
 * 不要给整页加 —— 承诺文案没必要进客户端 bundle。
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

        {/* 主动作：login-agent 接 OAuth。当前 disabled，避免点了没反应。 */}
        <button
          className="mt-8 rounded-full bg-coral px-6 py-3 text-sm font-bold text-white shadow-md transition hover:bg-[#004bbb] disabled:cursor-not-allowed disabled:opacity-45"
          disabled
          type="button"
        >
          登录并编译我的知识
        </button>
        <p className="mt-2 font-mono text-[10px] text-ink/35">OAuth 待接入</p>

        {/* 演示退路：不登录也能走完三幕，Demo 的兜底就靠它。 */}
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

      <ScaffoldNotice
        owner="login-agent"
        todo={[
          "接入知乎 OAuth 登录动作（需 CCR：本分支缺 app/api/auth/** 回调路由）",
          "跳转中 / 授权失败 / 离线三种状态",
          "登录后分流：首次登录去编译台，无新文章直达空间",
          "空账号（0 篇创作）引导去演示空间",
          "响应式与窄屏布局",
        ]}
      />
    </PageShell>
  );
}
