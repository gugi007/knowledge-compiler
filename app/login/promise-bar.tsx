/**
 * 品牌承诺条：三幕价值主张的静态展示。
 */

const PROMISES = [
  {
    step: "01",
    title: "连接知乎",
    desc: "读取公开创作。",
  },
  {
    step: "02",
    title: "编译知识网络",
    desc: "抽取概念与关系。",
  },
  {
    step: "03",
    title: "探索与生长",
    desc: "进入个人知识空间。",
  },
] as const;

export function PromiseBar() {
  return (
    <section
      aria-label="Knowledge Compiler 能做什么"
      className="panel mt-3 px-4 py-3 md:px-5"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <p className="eyebrow shrink-0">How it works</p>
        <div className="grid flex-1 gap-2 sm:grid-cols-3">
          {PROMISES.map((p) => (
            <div
              key={p.step}
              className="flex items-center gap-2 rounded-lg bg-lime/35 px-3 py-2"
            >
              <span className="font-display text-sm font-bold text-coral">{p.step}</span>
              <div className="min-w-0">
                <h3 className="text-xs font-bold leading-4">{p.title}</h3>
                <p className="truncate text-[10px] leading-4 text-ink/50">{p.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
