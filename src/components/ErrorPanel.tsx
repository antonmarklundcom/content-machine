"use client";

import { useTranslator } from "@/lib/i18n/client";
import type { TranslationKey } from "@/lib/i18n";

/**
 * The body of every route's error.tsx (PLAN.md §9 PR-18).
 *
 * Every page in this app reads MySQL on the server, and the header reads it on
 * every request — so a database that is down or misconfigured is not an edge
 * case here, it is the most likely failure in production. Without a boundary
 * that renders Next's generic crash page with no way back; with one the user
 * gets the reason and a retry that re-runs the server render.
 */
export function ErrorPanel({
  titleKey,
  error,
  reset,
}: {
  titleKey: TranslationKey;
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslator();

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <div className="surface-border surface-card flex flex-col items-start gap-4 p-8">
        <div>
          <p className="text-xs font-medium tracking-widest text-[var(--color-danger)] uppercase">
            {t("error.eyebrow")}
          </p>
          <h1 className="mt-1 text-xl font-semibold text-[var(--color-ink)]">{t(titleKey)}</h1>
        </div>
        <p className="text-sm text-[var(--color-ink-muted)] leading-relaxed">
          {error.message || t("error.noMessage")}
        </p>
        {error.digest && (
          <p className="font-mono text-xs text-[var(--color-ink-muted)]">digest: {error.digest}</p>
        )}
        <button
          type="button"
          onClick={reset}
          className="rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-[var(--color-accent-ink)] transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
        >
          {t("error.retry")}
        </button>
      </div>
    </main>
  );
}
