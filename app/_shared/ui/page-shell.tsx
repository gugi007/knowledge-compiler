import Link from "next/link";
import type { ReactNode } from "react";
import { ROUTES } from "@/lib/frontend/routes";

/**
 * 三幕共用的页面外框：顶栏 + 主内容区。
 *
 * 归 architect 维护。三个 feature agent 都用它，因此改动会影响所有页面——
 * 需要新增插槽时提 CCR，不要各自 fork 一份。
 */
export function PageShell({
  eyebrow,
  actions,
  children,
}: {
  /** 顶栏右侧的小字标签，说明当前处于哪一幕。 */
  eyebrow?: string;
  /** 顶栏右侧的操作区，放按钮或链接。 */
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="min-h-screen px-4 py-8 md:px-8">
      <div className="mx-auto max-w-6xl">
        <header className="glass-bar -mx-4 mb-2 flex items-center justify-between gap-4 px-4 py-3 md:-mx-8 md:px-8">
          <Link className="font-display text-xl font-semibold" href={ROUTES.login}>
            Knowledge Compiler
          </Link>
          <div className="flex items-center gap-3">
            {eyebrow && <span className="eyebrow">{eyebrow}</span>}
            {actions}
          </div>
        </header>
        {children}
      </div>
    </main>
  );
}
