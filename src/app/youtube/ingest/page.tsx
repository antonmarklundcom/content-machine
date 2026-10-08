import type { Metadata } from "next";
import { IngestForm } from "@/components/IngestForm";
import { isOwner } from "@/lib/auth/roles";
import { getSession } from "@/lib/auth/session";
import { getLocale } from "@/lib/i18n/server";
import { translator } from "@/lib/i18n";

export async function generateMetadata(): Promise<Metadata> {
  return { title: translator(await getLocale())("ingest.eyebrow") };
}

export default async function IngestPage() {
  const [locale, user] = await Promise.all([getLocale(), getSession()]);
  const t = translator(locale);
  const canSpend = isOwner(user);

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <p className="text-xs font-medium tracking-widest text-[var(--color-accent)] uppercase">
        {t("ingest.eyebrow")}
      </p>
      <h1 className="mt-1 text-2xl font-semibold text-[var(--color-ink)]">{t("ingest.title")}</h1>
      <p className="mt-2 text-sm text-[var(--color-ink-muted)] leading-relaxed">
        {t("ingest.intro")}
      </p>
      {!canSpend && (
        <p className="surface-border mt-4 rounded-[var(--radius-sm)] border-l-2 border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-ink)]">
          {t("role.employeeIngestNote")}
        </p>
      )}
      <div className="surface-border surface-card mt-6 p-5">
        <IngestForm locale={locale} />
      </div>
    </main>
  );
}
