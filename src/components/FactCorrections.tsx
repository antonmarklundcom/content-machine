import { formatDate } from "@/lib/format";
import { translator, type Locale } from "@/lib/i18n";
import type { ScriptNeedingCorrection } from "@/lib/studio/staleness";

/** "Videos that may need a correction" (build 2b, idea 3), linking each to its script in the studio. */
export function FactCorrections({
  flagged,
  locale,
}: {
  flagged: ScriptNeedingCorrection[];
  locale: Locale;
}) {
  const t = translator(locale);
  if (!flagged.length)
    return (
      <p className="mt-3 text-sm text-[var(--color-ink-muted)]">{t("facts.correctionsEmpty")}</p>
    );
  return (
    <ul className="mt-3 flex flex-col gap-3">
      {flagged.map((script) => (
        <li key={script.scriptId} className="surface-border surface-card p-4">
          <a
            href={`/studio/${script.scriptId}`}
            className="font-medium text-[var(--color-ink)] hover:text-[var(--color-accent)]"
          >
            {script.title}
          </a>
          <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
            {t("facts.postedOn", { date: formatDate(script.postedAt, locale) })}
          </p>
          <ul className="mt-2 flex flex-col gap-1 text-xs text-[var(--color-ink)]">
            {script.facts.map((fact) => (
              <li key={fact.id}>
                {t("facts.changedFact", {
                  date: formatDate(fact.updatedAt, locale),
                  claim: fact.claim,
                })}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}
