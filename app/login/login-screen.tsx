import Link from "next/link";
import { PageShell } from "@/app/_shared/ui/page-shell";
import { CORPORA } from "@/lib/frontend/corpora";
import { ROUTES } from "@/lib/frontend/routes";
import { LoginConnector } from "./login-connector";
import { PromiseBar } from "./promise-bar";

export function LoginScreen() {
  return (
    <PageShell eyebrow="Act 1 · 登录">
      <section className="hero-gradient hero-in panel mt-3 px-6 py-8 text-center md:px-10 md:py-10">
        <p className="eyebrow">Article Timeline → Knowledge Network</p>
        <h1 className="mx-auto mt-3 max-w-3xl font-display text-4xl leading-tight font-semibold tracking-tight md:text-5xl">
          登录知乎，编译你的知识宇宙
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-ink/60">
          把多年创作，编译成一张持续生长的知识网络。
        </p>

        <LoginConnector />

        <p className="mt-5 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-xs">
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

        <p className="mx-auto mt-4 max-w-lg text-[10px] leading-4 text-ink/40">
          只读取公开范围的创作数据 · 不复制内容，只编译观点 · 数据仅用于编译你的知识空间，可随时断开授权
        </p>
      </section>

      <PromiseBar />
    </PageShell>
  );
}
