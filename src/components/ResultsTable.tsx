import type { Translator } from "@/lib/i18n";
import type { GroupStats } from "@/lib/results/aggregate";

export function pct(rate: number | null): string {
  return rate === null ? "—" : `${(rate * 100).toFixed(1)}%`;
}

const num = (n: number) => n.toLocaleString("en-US");

/** One aggregate table on `/results` (build 4 §3.G): a row per group, rate first. */
export function ResultsTable({
  title,
  groups,
  t,
  labelOf = (k) => k,
}: {
  title: string;
  groups: GroupStats[];
  t: Translator;
  labelOf?: (key: string) => string;
}) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold text-[var(--color-ink)]">{title}</h2>
      {groups.length === 0 ? (
        <p className="mt-2 text-sm text-[var(--color-ink-muted)]">{t("growth.results.noPosts")}</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-[var(--color-ink-muted)]">
              <tr>
                <th className="py-1 pr-3 font-medium">{t("growth.results.group")}</th>
                <th className="py-1 pr-3 text-right font-medium">{t("growth.results.posts")}</th>
                <th className="py-1 pr-3 text-right font-medium">{t("growth.results.rate")}</th>
                <th className="py-1 pr-3 text-right font-medium">{t("growth.results.reach")}</th>
                <th className="py-1 pr-3 text-right font-medium">{t("growth.results.saves")}</th>
                <th className="py-1 pr-3 text-right font-medium">{t("growth.results.shares")}</th>
                <th className="py-1 pr-3 text-right font-medium">{t("growth.results.comments")}</th>
                <th className="py-1 text-right font-medium">{t("growth.results.likes")}</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.key} className="border-t border-[var(--color-border-subtle)]">
                  <td className="py-1.5 pr-3 text-[var(--color-ink)]">{labelOf(g.key)}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">
                    {g.posts}
                    {g.measured < g.posts ? (
                      <span className="text-xs text-[var(--color-ink-muted)]">
                        {" "}
                        ({t("growth.results.measured", { n: g.measured })})
                      </span>
                    ) : null}
                  </td>
                  <td className="py-1.5 pr-3 text-right font-medium tabular-nums">
                    {pct(g.avgRate)}
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{num(g.reach)}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{num(g.saves)}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{num(g.shares)}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{num(g.comments)}</td>
                  <td className="py-1.5 text-right tabular-nums">{num(g.likes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
