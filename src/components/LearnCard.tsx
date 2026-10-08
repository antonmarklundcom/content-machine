import type { Clip } from "@/db/schema";
import { formatDate } from "@/lib/format";
import { translator, type Locale, type TranslationKey } from "@/lib/i18n";
import { LearnActions } from "./LearnActions";

const CHIP =
  "surface-border inline-flex w-fit items-center rounded-[var(--radius-sm)] bg-[var(--color-surface)] px-2 py-0.5 text-xs text-[var(--color-ink-muted)]";

/** A linkless capture's pseudo-URL (the Worker's, or the aiinsights import's). */
function isScreenshotUrl(url: string): boolean {
  return url.startsWith("https://telegram.invalid/");
}

/** One learn item: summary, how-to-start steps, link, tags and the owner's buttons. */
export function LearnCard({ clip, locale }: { clip: Clip; locale: Locale }) {
  const t = translator(locale);
  const screenshot = isScreenshotUrl(clip.url);
  const title = clip.title || (screenshot ? t("learn.card.screenshot") : clip.url);
  const steps = clip.howToStart ?? [];

  return (
    <li className="surface-border surface-card flex flex-col gap-3 p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 className="text-base font-semibold break-words text-[var(--color-ink)]">{title}</h2>
        <div className="flex flex-wrap gap-1">
          {clip.learnCategory && (
            <span className={CHIP}>
              {t(`learn.category.${clip.learnCategory}` as TranslationKey)}
            </span>
          )}
          {clip.implementedAt && (
            <span className="inline-flex items-center rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-2 py-0.5 text-xs text-[var(--color-accent-ink)]">
              {t("learn.card.implementedOn", { date: formatDate(clip.implementedAt, locale) })}
            </span>
          )}
          {clip.committedAt && !clip.implementedAt && (
            <span className={CHIP}>
              {t("learn.card.committedOn", { date: formatDate(clip.committedAt, locale) })}
            </span>
          )}
        </div>
      </div>

      {clip.note && <p className="text-sm text-[var(--color-ink-muted)] italic">{clip.note}</p>}

      {clip.summary && clip.learnCategory ? (
        <p className="text-sm leading-relaxed whitespace-pre-line text-[var(--color-ink)]">
          {clip.summary}
        </p>
      ) : (
        <p className="text-sm text-[var(--color-ink-muted)]">{t("learn.card.notSummarised")}</p>
      )}

      {steps.length > 0 && (
        <div>
          <p className="text-xs font-medium tracking-wide text-[var(--color-ink-muted)] uppercase">
            {t("learn.card.howToStart")}
          </p>
          <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm text-[var(--color-ink)]">
            {steps.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-ink-muted)]">
        {!screenshot && (
          <a
            href={clip.url}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-[var(--color-accent)] hover:underline"
          >
            {t("learn.card.open")}
          </a>
        )}
        <span>{t("learn.card.savedOn", { date: formatDate(clip.savedAt, locale) })}</span>
        {clip.tags.map((tag) => (
          <a key={tag} href={`/learn?q=${encodeURIComponent(tag)}`} className={CHIP}>
            #{tag}
          </a>
        ))}
      </div>

      {clip.error && (
        <p className="text-xs text-[var(--color-danger)]">
          {t("learn.card.error", { error: clip.error })}
        </p>
      )}

      <LearnActions
        clipId={clip.id}
        summarised={Boolean(clip.learnCategory)}
        implemented={Boolean(clip.implementedAt)}
        committed={Boolean(clip.committedAt)}
      />
    </li>
  );
}
