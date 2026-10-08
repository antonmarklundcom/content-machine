import { isCulled, screenMinScore } from "@/lib/screening/policy";
import { translator, type Locale } from "@/lib/i18n";

/**
 * [PR-35] Marks a video the gallring declined to spend an analysis on.
 *
 * Only the culled case renders. A kept video says nothing — every video in the
 * feed that is not marked has, by construction, either passed the screen or
 * never been screened, and a "kept" badge on almost everything would be
 * decoration rather than information.
 *
 * The score and the model's sentence are in the tooltip rather than the badge,
 * because the question the card has to answer at a glance is "why is nobody
 * analysing this", and the answer to "on what grounds" is one hover away.
 */
export function ScreenBadge({
  score,
  reason,
  locale,
}: {
  score: number | null;
  reason?: string | null;
  locale: Locale;
}) {
  const minScore = screenMinScore();
  if (!isCulled({ status: "ok", score }, minScore)) return null;
  const t = translator(locale);

  return (
    <span
      title={`${t("screen.score")} ${score}/${minScore}${reason ? ` — ${reason}` : ""}`}
      className="surface-border inline-flex w-fit items-center rounded-[var(--radius-sm)] bg-[var(--color-surface)] px-2 py-0.5 text-xs font-medium text-[var(--color-ink-muted)]"
    >
      {t("screen.culled")}
    </span>
  );
}
