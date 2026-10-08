import type { Metadata } from "next";
import Link from "next/link";
import { ReportGenerateButton } from "@/components/ReportGenerateButton";
import { ReportView } from "@/components/ReportView";
import { isOwner } from "@/lib/auth/roles";
import { requireUser } from "@/lib/auth/session";
import { listBrands } from "@/lib/bridge/brands";
import { listCompetitorReports } from "@/lib/bridge/reports";
import { formatDate } from "@/lib/format";
import { translator } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: translator(await getLocale())("report.title") };
}

const CHIP =
  "rounded-[var(--radius-sm)] px-3 py-1.5 text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]";
const CHIP_ON = `${CHIP} bg-[var(--color-accent)] text-[var(--color-accent-ink)]`;
const CHIP_OFF = `${CHIP} surface-border text-[var(--color-ink)] hover:border-[var(--color-accent)]`;

/**
 * `/research/report?brand=<id>[&id=<reportId>]` — the latest competitor report
 * for a brand (build 2b, idea 1), older ones listed below it. "Generate now"
 * is the owner's; the weekly run is `npm run studio:weekly`.
 */
export default async function ReportPage({
  searchParams,
}: {
  searchParams: Promise<{ brand?: string; id?: string }>;
}) {
  const [params, brands, locale, user] = await Promise.all([
    searchParams,
    listBrands(),
    getLocale(),
    requireUser(),
  ]);
  const t = translator(locale);
  const brand = brands.find((b) => b.id === params.brand) ?? brands[0];
  const reports = brand ? await listCompetitorReports(brand.id, 30) : [];
  const picked = reports.find((r) => String(r.id) === params.id);
  const shown = picked ?? reports[0];
  const href = (q: Record<string, string>) => `/research/report?${new URLSearchParams(q)}`;

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <p className="text-xs font-medium tracking-widest text-[var(--color-accent)] uppercase">
        {t("report.eyebrow")}
      </p>
      <h1 className="mt-1 text-2xl font-semibold text-[var(--color-ink)]">{t("report.title")}</h1>
      <p className="mt-2 text-sm leading-relaxed text-[var(--color-ink-muted)]">
        {t("report.intro")}
      </p>

      {!brand ? (
        <p className="mt-8 text-sm text-[var(--color-ink-muted)]">{t("report.noBrands")}</p>
      ) : (
        <>
          <nav aria-label={t("report.brand")} className="mt-6 flex flex-wrap gap-2">
            {brands.map((b) => (
              <a
                key={b.id}
                href={href({ brand: b.id })}
                aria-current={b.id === brand.id ? "page" : undefined}
                className={b.id === brand.id ? CHIP_ON : CHIP_OFF}
              >
                {b.name}
              </a>
            ))}
          </nav>

          <div className="mt-6 flex flex-wrap items-start justify-between gap-3">
            <div className="flex flex-wrap gap-3 text-xs">
              <Link
                href={`/research?${new URLSearchParams({ brand: brand.id })}`}
                className="underline text-[var(--color-ink-muted)] hover:text-[var(--color-accent)]"
              >
                {t("report.toResearch")}
              </Link>
              <Link
                href={`/research/questions?${new URLSearchParams({ brand: brand.id })}`}
                className="underline text-[var(--color-ink-muted)] hover:text-[var(--color-accent)]"
              >
                {t("report.toQuestions")}
              </Link>
            </div>
            {isOwner(user) ? (
              <ReportGenerateButton brandId={brand.id} />
            ) : (
              <p className="text-xs text-[var(--color-ink-muted)]">{t("report.ownerOnly")}</p>
            )}
          </div>

          {picked && picked.id !== reports[0]?.id && (
            <p className="mt-4 text-xs text-[var(--color-warn)]">
              {t("report.viewing")}: {formatDate(picked.createdAt, locale)} ·{" "}
              <a href={href({ brand: brand.id })} className="underline">
                {t("report.backToLatest")}
              </a>
            </p>
          )}

          {shown ? (
            <ReportView report={shown} locale={locale} />
          ) : (
            <p className="mt-8 text-sm text-[var(--color-ink-muted)]">{t("report.empty")}</p>
          )}

          {reports.length > 1 && (
            <section className="mt-10">
              <h2 className="text-lg font-semibold text-[var(--color-ink)]">{t("report.older")}</h2>
              <ul className="mt-3 flex flex-col gap-1 text-sm">
                {reports
                  .filter((r) => r.id !== shown?.id)
                  .map((r) => (
                    <li key={r.id}>
                      <a
                        href={href({ brand: brand.id, id: String(r.id) })}
                        className="underline text-[var(--color-ink)] hover:text-[var(--color-accent)]"
                      >
                        {t("report.createdAt", {
                          date: formatDate(r.createdAt, locale),
                          days: r.periodDays,
                        })}
                      </a>
                      <span className="text-[var(--color-ink-muted)]">
                        {" "}
                        — {r.body.summary.slice(0, 120)}
                        {r.body.summary.length > 120 ? "…" : ""}
                      </span>
                    </li>
                  ))}
              </ul>
            </section>
          )}
        </>
      )}
    </main>
  );
}
