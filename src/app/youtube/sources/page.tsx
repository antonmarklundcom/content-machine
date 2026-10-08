import type { Metadata } from "next";
import { AddSourceForm } from "@/components/AddSourceForm";
import { ConfirmSubmitButton } from "@/components/ConfirmSubmitButton";
import { SourceTitleForm } from "@/components/SourceTitleForm";
import { removeSource, setSourceActive } from "@/lib/sources.actions";
import { listSourcesWithCounts } from "@/lib/sources";
import { formatDate } from "@/lib/format";
import { isOwner } from "@/lib/auth/roles";
import { getSession } from "@/lib/auth/session";
import { getLocale } from "@/lib/i18n/server";
import { translator } from "@/lib/i18n";

export async function generateMetadata(): Promise<Metadata> {
  return { title: translator(await getLocale())("sources.eyebrow") };
}

const BUTTON =
  "surface-border rounded-[var(--radius-sm)] px-3 py-1.5 text-xs font-medium text-[var(--color-ink)] hover:border-[var(--color-accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]";

export default async function SourcesPage() {
  const [rows, locale, user] = await Promise.all([
    listSourcesWithCounts(),
    getLocale(),
    getSession(),
  ]);
  const t = translator(locale);
  // Adding and pausing stay open to an employee; removing does not.
  const canRemove = isOwner(user);

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <p className="text-xs font-medium tracking-widest text-[var(--color-accent)] uppercase">
        {t("sources.eyebrow")}
      </p>
      <h1 className="mt-1 text-2xl font-semibold text-[var(--color-ink)]">{t("sources.title")}</h1>
      <p className="mt-2 text-sm text-[var(--color-ink-muted)] leading-relaxed">
        {t("sources.cronNote")}
      </p>

      <div className="surface-border surface-card mt-6 p-5">
        <AddSourceForm locale={locale} />
      </div>

      {rows.length === 0 ? (
        <p className="mt-8 text-sm text-[var(--color-ink-muted)]">{t("sources.empty")}</p>
      ) : (
        <ul className="mt-6 flex flex-col gap-3">
          {rows.map((source) => (
            <li key={source.id} className="surface-border surface-card flex flex-col gap-3 p-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <SourceTitleForm id={source.id} title={source.title} locale={locale} />
                  <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
                    {t(
                      source.kind === "channel" ? "sources.kind.channel" : "sources.kind.playlist",
                    )}{" "}
                    · {t(source.active ? "sources.active" : "sources.paused")} · {source.videoCount}{" "}
                    {t(
                      source.videoCount === 1 ? "sources.videoCountOne" : "sources.videoCountMany",
                    )}{" "}
                    · {t("sources.lastPolled")}{" "}
                    {source.lastPolledAt
                      ? formatDate(source.lastPolledAt, locale)
                      : t("sources.never")}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <form action={setSourceActive.bind(null, source.id, !source.active)}>
                    <button type="submit" className={BUTTON}>
                      {t(source.active ? "sources.pause" : "sources.resume")}
                    </button>
                  </form>
                  {canRemove && (
                    <form action={removeSource.bind(null, source.id)}>
                      <ConfirmSubmitButton
                        message={t("sources.removeConfirm")}
                        className={`${BUTTON} text-[var(--color-danger)] hover:border-[var(--color-danger)]`}
                      >
                        {t("sources.remove")}
                      </ConfirmSubmitButton>
                    </form>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
