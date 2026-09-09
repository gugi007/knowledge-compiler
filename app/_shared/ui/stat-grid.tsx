/**
 * 规模统计栅格。编译台完成态与知识空间作者头都要展示同一组数字，
 * 放在这里保证两幕的呈现口径一致。
 */
export function StatGrid({ items }: { items: { label: string; value: number | string }[] }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {items.map(({ label, value }) => (
        <div className="rounded-xl border border-ink/10 bg-white p-3 text-center" key={label}>
          <strong className="font-display text-2xl">{value}</strong>
          <p className="text-[9px] font-bold tracking-wider text-ink/40 uppercase">{label}</p>
        </div>
      ))}
    </div>
  );
}
