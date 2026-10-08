import { HiggsfieldJobs } from "@/components/HiggsfieldJobs";
import { HiggsfieldPreflight } from "@/components/HiggsfieldPreflight";
import { HiggsfieldFreeForm, HiggsfieldImportForm } from "@/components/HiggsfieldRunForms";
import { isOwner } from "@/lib/auth/roles";
import { requireUser } from "@/lib/auth/session";
import { listAllBrands } from "@/lib/bridge/brands";
import { defaultMaxCredits } from "@/lib/higgsfield/config";
import { cachedPreflight } from "@/lib/higgsfield/preflight";
import { listJobs, reapJobs } from "@/lib/higgsfield/run";
import { translator } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/server";

/**
 * /higgsfield (build 4 §3.H): is this PC ready, start a free prompt or a
 * history import, and every run with its status, credits, files and log.
 * Post and script runs start from their own pages (HiggsfieldGenerateButton).
 */
export default async function HiggsfieldPage() {
  const user = await requireUser();
  const locale = await getLocale();
  const t = translator(locale);

  if (!isOwner(user)) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-10">
        <h1 className="text-2xl font-semibold text-[var(--color-ink)]">{t("higgsfield.title")}</h1>
        <p className="mt-2 text-sm text-[var(--color-ink-muted)]">{t("higgsfield.ownerOnly")}</p>
      </main>
    );
  }

  await reapJobs();
  const [jobs, brands] = await Promise.all([listJobs(50), listAllBrands()]);
  const ceiling = defaultMaxCredits();

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <p className="text-xs font-medium tracking-widest text-[var(--color-accent)] uppercase">
        {t("higgsfield.eyebrow")}
      </p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[var(--color-ink)]">
        {t("higgsfield.title")}
      </h1>
      <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{t("higgsfield.intro")}</p>
      <p className="mt-1 text-xs text-[var(--color-ink-muted)]">{t("higgsfield.pcOnly")}</p>

      <div className="mt-6">
        <HiggsfieldPreflight initial={cachedPreflight()} />
      </div>

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <div className="surface-border rounded-[var(--radius-md)] bg-[var(--color-surface-raised)] p-4">
          <HiggsfieldFreeForm
            brands={brands.map((b) => ({ id: b.id, name: b.name }))}
            defaultMaxCredits={ceiling}
          />
        </div>
        <div className="surface-border rounded-[var(--radius-md)] bg-[var(--color-surface-raised)] p-4">
          <HiggsfieldImportForm />
        </div>
      </div>

      <HiggsfieldJobs jobs={jobs} locale={locale} />
    </main>
  );
}
