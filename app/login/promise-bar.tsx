/**
 * 品牌承诺条：三幕价值主张的静态展示。
 *
 * OWNER: login-agent
 *
 * 纯展示组件，保留为 server component，不进客户端 bundle。
 */

const PROMISES = [
  {
    step: "01",
    title: "连接知乎",
    desc: "只读取公开创作，不复制全文，授权可随时断开。",
  },
  {
    step: "02",
    title: "编译知识网络",
    desc: "自动抽取概念，并发现概念之间的 prerequisite / extends / related 关系。",
  },
  {
    step: "03",
    title: "探索与生长",
    desc: "把概念与关系编译成一张可探索、可生长的个人知识网络。",
  },
] as const;

export function PromiseBar() {
  return (
    <section
      aria-label="Knowledge Compiler 能做什么"
      className="panel mt-4 px-6 py-8 md:px-10"
    >
      <p className="eyebrow">How it works</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        {PROMISES.map((p) => (
          <div
            key={p.step}
            className="flex h-full flex-col items-start rounded-xl bg-lime/40 p-4"
          >
            <span className="font-display text-lg font-bold text-coral">
              {p.step}
            </span>
            <h3 className="mt-1 text-sm font-bold">{p.title}</h3>
            <p className="mt-1 text-[12px] leading-5 text-ink/55">{p.desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
