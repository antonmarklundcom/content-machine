import type { Metadata } from "next";
import Link from "next/link";

import { IgCompetitorPosts } from "@/components/IgCompetitorPosts";
import { requireUser } from "@/lib/auth/session";
import { formatCompactNumber, formatDate } from "@/lib/format";
import { translator } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/server";
import { listIgAccounts, weeklyReport } from "@/lib/meta/discovery";

export async function generateMetadata(): Promise<Metadata> {
  return { title: translator(await getLocale())("ig.report.title") };
}

const CHIP =
  "rounded-[var(--radius-sm)] px-3 py-1.5 text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]";
const CHIP_ON = `${CHIP} bg-[var(--color-accent)] text-[var(--color-accent-ink)]`;
const CHIP_OFF = `${CHIP} surface-border text-[var(--color-ink)] hover:border-[var(--color-accent)]`;

const pct = (rate: number | null) => (rate === null ? "—" : `${(rate * 100).toFixed(1)}%`);

/**
 * `/research/instagram/report?account=<id>` — one own Instagram account's
 * week: its posts' newest metrics, the best competitor posts for its brand,
 * and three suggested next posts (PLAN.md §6.S21).
 */
export default async function IgWeeklyReportPage({
  searchParams,
}: {
  searchParams: Promise<{ account?: string }>;
}) {
  const [params, locale, accounts] = await Promise.all([
    searchParams,
    getLocale(),
    listIgAccounts(),
    requireUser(),
  ]);
  const t = translator(locale);
  const account = accounts.find((a) => String(a.id) === params.account) ?? accounts[0];
  const report = account ? await weeklyReport(account.id) : null;

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <p className="text-xs font-medium tracking-widest text-[var(--color-accent)] uppercase">
        {t("ig.eyebrow")}
      </p>
      <h1 className="mt-1 text-2xl font-semibold text-[var(--color-ink)]">
        {t("ig.report.title")}
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-[var(--color-ink-muted)]">
        {t("ig.report.intro")}
      </p>
      <div className="mt-3 text-xs">
        <Link
          href="/research/instagram"
          className="underline text-[var(--color-ink-muted)] hover:text-[var(--color-accent)]"
        >
          {t("ig.report.toCompetitors")}
        </Link>
      </div>

      {!account || !report ? (
        <p className="mt-8 text-sm text-[var(--color-ink-muted)]">{t("ig.report.noAccounts")}</p>
      ) : (
        <>
          <nav aria-label={t("ig.report.account")} className="mt-6 flex flex-wrap gap-2">
            {accounts.map((a) => (
              <a
                key={a.id}
                href={`/research/instagram/report?${new URLSearchParams({ account: String(a.id) })}`}
                aria-current={a.id === account.id ? "page" : undefined}
                className={a.id === account.id ? CHIP_ON : CHIP_OFF}
              >
                @{a.handle}
              </a>
            ))}
          </nav>

          <p className="mt-6 text-sm text-[var(--color-ink-muted)]">
            {t("ig.report.range", {
              from: formatDate(report.from, locale),
              to: formatDate(report.to, locale),
            })}
          </p>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:max-w-md">
            <div className="surface-border rounded-[var(--radius-sm)] p-3">
              <dt className="text-xs text-[var(--color-ink-muted)]">{t("ig.report.followers")}</dt>
              <dd className="mt-1 font-semibold text-[var(--color-ink)]">
                {formatCompactNumber(report.followers.end, locale)}
                {report.followers.start !== null && report.followers.end !== null ? (
                  <span className="ml-2 text-xs font-normal text-[var(--color-ink-muted)]">
                    {report.followers.end - report.followers.start >= 0 ? "+" : ""}
                    {report.followers.end - report.followers.start}
                  </span>
                ) : null}
              </dd>
            </div>
            <div className="surface-border rounded-[var(--radius-sm)] p-3">
              <dt className="text-xs text-[var(--color-ink-muted)]">{t("ig.report.reach")}</dt>
              <dd className="mt-1 font-semibold text-[var(--color-ink)]">
                {formatCompactNumber(report.reach, locale)}
              </dd>
            </div>
          </dl>

          <section className="mt-10">
            <h2 className="text-lg font-semibold text-[var(--color-ink)]">{t("ig.report.own")}</h2>
            {report.own.length === 0 ? (
              <p className="mt-3 text-sm text-[var(--color-ink-muted)]">{t("ig.report.ownNone")}</p>
            ) : (
              <ul className="mt-3 space-y-2 text-sm">
                {report.own.map((p) => (
                  <li key={p.id} className="surface-border rounded-[var(--radius-sm)] p-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <Link
                        href={`/posts/${p.id}`}
                        className="font-medium text-[var(--color-ink)] underline hover:text-[var(--color-accent)]"
                      >
                        {p.title}
                      </Link>
                      <span className="text-xs font-semibold text-[var(--color-accent)]">
                        {t("ig.report.rate")} {pct(p.rate)}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
                      {p.format} · {formatDate(p.publishedAt, locale)} · reach{" "}
                      {formatCompactNumber(p.reach, locale)} · {p.likes ?? 0} likes ·{" "}
                      {p.comments ?? 0} comments · {p.saves ?? 0} saves · {p.shares ?? 0} shares
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="mt-10">
            <h2 className="text-lg font-semibold text-[var(--color-ink)]">{t("ig.report.next")}</h2>
            {report.suggestions.length === 0 ? (
              <p className="mt-3 text-sm text-[var(--color-ink-muted)]">
                {t("ig.report.nextNone")}
              </p>
            ) : (
              <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm">
                {report.suggestions.map((s, i) => (
                  <li key={i}>
                    <p className="font-medium text-[var(--color-ink)]">{s.title}</p>
                    <p className="text-xs text-[var(--color-ink-muted)]">
                      {s.why}
                      {s.permalink ? (
                        <>
                          {" "}
                          <a
                            href={s.permalink}
                            target="_blank"
                            rel="noreferrer"
                            className="underline hover:text-[var(--color-accent)]"
                          >
                            {t("ig.open")}
                          </a>
                        </>
                      ) : null}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section className="mt-10">
            <h2 className="text-lg font-semibold text-[var(--color-ink)]">{t("ig.report.best")}</h2>
            <IgCompetitorPosts
              posts={report.best}
              empty={t("ig.best.none")}
              t={t}
              locale={locale}
            />
          </section>
        </>
      )}
    </main>
  );
}
