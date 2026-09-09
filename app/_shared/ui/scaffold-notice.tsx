/**
 * 骨架页占位提示。
 *
 * 每个 v2 路由现在都只有骨架，用这个组件明确标出「谁来实现、还差什么」，
 * 避免后续 agent 误以为页面已经做完。feature agent 实现完成后应删掉对它的引用。
 */
export function ScaffoldNotice({
  owner,
  todo,
}: {
  /** 负责实现这块的 agent 名。 */
  owner: string;
  /** 待实现项清单。 */
  todo: string[];
}) {
  return (
    <section className="panel mt-6 p-5 md:p-7">
      <p className="eyebrow">Scaffold · 待实现</p>
      <p className="mt-2 text-sm leading-6 text-ink/70">
        这一幕由 <strong className="font-mono text-xs">{owner}</strong> 实现。当前是 architect
        搭好的骨架，只验证路由与契约可用。
      </p>
      <ul className="mt-4 grid gap-1.5">
        {todo.map((item) => (
          <li className="flex gap-2 text-sm leading-6 text-ink/60" key={item}>
            <span aria-hidden className="text-ink/25">□</span>
            {item}
          </li>
        ))}
      </ul>
    </section>
  );
}
