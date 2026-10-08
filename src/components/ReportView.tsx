import Link from "next/link";
import type { SavedReport } from "@/lib/bridge/reports";
import { formatDate } from "@/lib/format";
import { translator, type Locale } from "@/lib/i18n";
import { writeScriptHref } from "@/lib/studio/report-contract";
import { formatUsd } from "@/lib/spend";

const LINK =
  "surface-border rounded-[var(--radius-sm)] px-3 py-1.5 text-xs font-medium text-[var(--color-ink)] hover:border-[var(--color-accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]";

/**
 * One saved competitor report (build 2b, idea 1): summary, the winners and why,
 * patterns, and ideas — each with "Write script", which opens the brief with
 * the idea as the topic and the videos it rests on as references.
 */
export function ReportView({ report, locale }: { report: SavedReport; locale: Locale }) {
  const t = translator(locale);
  const { body } = report;
  const titles = new Map(body.winners.map((w) => [w.videoId, w.title]));

  return (
    <article className="mt-6 flex flex-col gap-8">
      <p className="text-xs text-[var(--color-ink-muted)]">
        {t("report.createdAt", {
          date: formatDate(report.createdAt, locale),
          days: report.periodDays,
        })}
        {report.costUsd > 0 ? ` · ${t("report.cost", { cost: formatUsd(report.costUsd) })}` : ""}
      </p>

      <section className="surface-border surface-card p-5">
        <h2 className="text-lg font-semibold text-[var(--color-ink)]">{t("report.summary")}</h2>
        <p className="mt-2 text-sm leading-relaxed text-[var(--color-ink)]">{body.summary}</p>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-[var(--color-ink)]">{t("report.ideas")}</h2>
        {body.ideas.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--color-ink-muted)]">{t("report.ideasEmpty")}</p>
        ) : (
          <ol className="mt-3 flex flex-col gap-3">
            {body.ideas.map((idea, i) => (
              <li key={i} className="surface-border surface-card flex flex-col gap-2 p-4">
                <h3 className="font-medium leading-snug text-[var(--color-ink)]">{idea.title}</h3>
                <p className="text-sm leading-relaxed text-[var(--color-ink-muted)]">
                  {idea.angle}
                </p>
                {idea.basedOnVideoIds.length > 0 && (
                  <p className="text-xs text-[var(--color-ink-muted)]">
                    {t("report.basedOn")}:{" "}
                    {idea.basedOnVideoIds.map((id, n) => (
                      <span key={id}>
                        {n > 0 ? ", " : ""}
                        <Link
                          href={`/youtube/video/${id}`}
                          className="underline hover:text-[var(--color-accent)]"
                        >
                          {titles.get(id) ?? `#${id}`}
                        </Link>
                      </span>
                    ))}
                  </p>
                )}
                <div>
                  <Link
                    href={writeScriptHref(report.brandId, idea.title, idea.basedOnVideoIds)}
                    className={LINK}
                  >
                    {t("report.writeScript")}
                  </Link>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold text-[var(--color-ink)]">{t("report.winners")}</h2>
        {body.winners.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--color-ink-muted)]">{t("report.winnersEmpty")}</p>
        ) : (
          <ol className="mt-3 flex flex-col gap-3">
            {body.winners.map((w) => (
              <li key={w.videoId} className="surface-border surface-card flex flex-col gap-2 p-4">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-medium leading-snug text-[var(--color-ink)]">{w.title}</h3>
                  <span className="shrink-0 rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-2 py-0.5 text-xs font-semibold text-[var(--color-accent-ink)]">
                    {t("report.score", { score: w.outlierScore.toFixed(1) })}
                  </span>
                </div>
                <p className="text-xs text-[var(--color-ink-muted)]">{w.channel}</p>
                <p className="text-sm leading-relaxed text-[var(--color-ink-muted)]">
                  {w.whyItWorked}
                </p>
                <div>
                  <Link href={`/youtube/video/${w.videoId}`} className={LINK}>
                    {t("report.openVideo")}
                  </Link>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      {body.patterns.length > 0 && (
        <section className="surface-border surface-card p-5">
          <h2 className="text-lg font-semibold text-[var(--color-ink)]">{t("report.patterns")}</h2>
          <ul className="mt-2 list-disc pl-5 text-sm leading-relaxed text-[var(--color-ink)]">
            {body.patterns.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
