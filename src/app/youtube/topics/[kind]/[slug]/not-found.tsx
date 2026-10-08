import Link from "next/link";
import { getLocale } from "@/lib/i18n/server";
import { translator } from "@/lib/i18n";

/**
 * [PR-34] Reached for an unknown kind and for a slug nothing is tagged with.
 *
 * A tag that does not exist is a wrong URL rather than an empty shelf: every
 * tag on this site was written by an analysis, so a missing one was mistyped or
 * has since been retagged away by a newer analysis.
 */
export default async function TagNotFound() {
  const t = translator(await getLocale());

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <div className="surface-border surface-card flex flex-col items-start gap-4 p-8">
        <div>
          <p className="text-xs font-medium tracking-widest text-[var(--color-accent)] uppercase">
            404
          </p>
          <h1 className="mt-1 text-xl font-semibold text-[var(--color-ink)]">
            {t("notFound.topic.title")}
          </h1>
        </div>
        <p className="text-sm text-[var(--color-ink-muted)]">{t("notFound.topic.body")}</p>
        <Link
          href="/youtube/topics"
          className="rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-[var(--color-accent-ink)] transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
        >
          {t("topics.backToTopics")}
        </Link>
      </div>
    </main>
  );
}
