import type { Metadata } from "next";
import Link from "next/link";

import { pct, ResultsTable } from "@/components/ResultsTable";
import { ResultsSparkline } from "@/components/ResultsSparkline";
import { requireUser } from "@/lib/auth/session";
import { listAccounts, listBrands } from "@/lib/bridge";
import { formatDate } from "@/lib/format";
import { translator, type TranslationKey } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/server";
import { engagementRate, type HookShape, type ResultPost } from "@/lib/results/aggregate";
import { loadResults } from "@/lib/results/load";
import { resultsRange } from "@/lib/results/range";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: translator(await getLocale())("growth.results.title") };
}

const CHIP =
  "rounded-[var(--radius-sm)] px-3 py-1.5 text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]";
const CHIP_ON = `${CHIP} bg-[var(--color-accent)] text-[var(--color-accent-ink)]`;
const CHIP_OFF = `${CHIP} surface-border text-[var(--color-ink)] hover:border-[var(--color-accent)]`;
const INPUT =
  "surface-border rounded-[var(--radius-sm)] bg-transparent px-2 py-1.5 text-sm text-[var(--color-ink)]";

const DAY_CHOICES = [30, 90, 180, 365];
/** The all-posts table stops here; the aggregates still count every post. */
const POST_TABLE_LIMIT = 200;

const HOOK_KEY: Record<HookShape, TranslationKey> = {
  question: "growth.results.hook.question",
  number: "growth.results.hook.number",
  how_to: "growth.results.hook.how_to",
  negation: "growth.results.hook.negation",
  statement: "growth.results.hook.statement",
  none: "growth.results.hook.none",
};

/**
 * `/results?brand=<id>&account=<id>&days=90` (or `from=YYYY-MM-DD&to=…`) — what
 * published posts did (build 4 §3.G). Read-only. Engagement rate is
 * (saves + shares + comments) / reach on each post's newest snapshot, the
 * same rate "what worked" ranks by (PLAN.md §1.51).
 */
export default async function ResultsPage({
  searchParams,
}: {
  searchParams: Promise<{
    brand?: string;
    account?: string;
    days?: string;
    from?: string;
    to?: string;
  }>;
}) {
  const [params, locale, brands] = await Promise.all([searchParams, getLocale(), listBrands()]);
  await requireUser();
  const t = translator(locale);
  const brand = brands.find((b) => b.id === params.brand) ?? brands[0];
  const accounts = brand ? await listAccounts({ brandId: brand.id }) : [];
  const account = accounts.find((a) => String(a.id) === params.account);
  const range = resultsRange(params);
  const results = brand
    ? await loadResults({
        brandId: brand.id,
        accountId: account?.id,
        from: range.from,
        to: range.to,
      })
    : null;

  const href = (q: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== "") p.set(k, String(v));
    return `/results?${p}`;
  };
  const keep = {
    brand: brand?.id,
    account: account?.id,
    days: range.days ?? undefined,
    from: range.days === null ? params.from : undefined,
    to: range.days === null ? params.to : undefined,
  };
  const rateOf = (p: ResultPost) => engagementRate(p.metrics);

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <p className="text-xs font-medium tracking-widest text-[var(--color-accent)] uppercase">
        {t("growth.eyebrow")}
      </p>
      <h1 className="mt-1 text-2xl font-semibold text-[var(--color-ink)]">
        {t("growth.results.title")}
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-[var(--color-ink-muted)]">
        {t("growth.results.intro")}
      </p>

      {!brand || !results ? (
        <p className="mt-8 text-sm text-[var(--color-ink-muted)]">{t("growth.noBrands")}</p>
      ) : (
        <>
          <nav aria-label={t("growth.brand")} className="mt-6 flex flex-wrap gap-2">
            {brands.map((b) => (
              <a
                key={b.id}
                href={href({ ...keep, brand: b.id, account: undefined })}
                aria-current={b.id === brand.id ? "page" : undefined}
                className={b.id === brand.id ? CHIP_ON : CHIP_OFF}
              >
                {b.name}
              </a>
            ))}
          </nav>
          {accounts.length > 1 ? (
            <nav aria-label={t("growth.account")} className="mt-3 flex flex-wrap gap-2">
              <a
                href={href({ ...keep, account: undefined })}
                aria-current={!account ? "page" : undefined}
                className={!account ? CHIP_ON : CHIP_OFF}
              >
                {t("growth.all")}
              </a>
              {accounts.map((a) => (
                <a
                  key={a.id}
                  href={href({ ...keep, account: a.id })}
                  aria-current={account?.id === a.id ? "page" : undefined}
                  className={account?.id === a.id ? CHIP_ON : CHIP_OFF}
                >
                  {a.platform} @{a.handle}
                </a>
              ))}
            </nav>
          ) : null}
          <div className="mt-3 flex flex-wrap items-end gap-2">
            {DAY_CHOICES.map((d) => (
              <a
                key={d}
                href={href({ ...keep, days: d, from: undefined, to: undefined })}
                aria-current={range.days === d ? "page" : undefined}
                className={range.days === d ? CHIP_ON : CHIP_OFF}
              >
                {t("growth.results.days", { n: d })}
              </a>
            ))}
            <form action="/results" className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="brand" value={brand.id} />
              {account ? <input type="hidden" name="account" value={account.id} /> : null}
              <label className="flex flex-col gap-1 text-xs text-[var(--color-ink-muted)]">
                {t("growth.results.from")}
                <input
                  type="date"
                  name="from"
                  defaultValue={range.from.toISOString().slice(0, 10)}
                  className={INPUT}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-[var(--color-ink-muted)]">
                {t("growth.results.to")}
                <input
                  type="date"
                  name="to"
                  defaultValue={range.to.toISOString().slice(0, 10)}
                  className={INPUT}
                />
              </label>
              <button type="submit" className={CHIP_OFF}>
                {t("growth.results.apply")}
              </button>
            </form>
          </div>

          <section className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              [t("growth.results.posts"), String(results.totals.posts)],
              [t("growth.results.measuredLabel"), String(results.totals.measured)],
              [t("growth.results.rate"), pct(results.totals.avgRate)],
              [t("growth.results.reach"), results.totals.reach.toLocaleString("en-US")],
            ].map(([label, value]) => (
              <div key={label} className="surface-border rounded-[var(--radius-sm)] p-3">
                <p className="text-xs text-[var(--color-ink-muted)]">{label}</p>
                <p className="mt-1 text-xl font-semibold text-[var(--color-ink)] tabular-nums">
                  {value}
                </p>
              </div>
            ))}
          </section>
          <p className="mt-2 text-xs text-[var(--color-ink-muted)]">
            {t("growth.results.rateHint")}
          </p>

          <section className="mt-8">
            <h2 className="text-lg font-semibold text-[var(--color-ink)]">
              {t("growth.results.followers")}
            </h2>
            {results.followers.length === 0 ? (
              <p className="mt-2 text-sm text-[var(--color-ink-muted)]">
                {t("growth.results.noFollowers")}
              </p>
            ) : (
              <ul className="mt-3 flex flex-col gap-2">
                {results.followers.map((f) => (
                  <li key={f.accountId} className="flex flex-wrap items-center gap-4 text-sm">
                    <span className="w-48 truncate text-[var(--color-ink)]">
                      {f.platform} @{f.handle}
                    </span>
                    <ResultsSparkline
                      values={f.trend.points.map((p) => p.followers)}
                      label={t("growth.results.followersOf", { handle: f.handle })}
                    />
                    <span className="tabular-nums text-[var(--color-ink-muted)]">
                      {f.trend.start?.toLocaleString("en-US")} →{" "}
                      {f.trend.end?.toLocaleString("en-US")} ({(f.trend.delta ?? 0) >= 0 ? "+" : ""}
                      {f.trend.delta?.toLocaleString("en-US")})
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="mt-8">
            <h2 className="text-lg font-semibold text-[var(--color-ink)]">
              {t("growth.results.top")}
            </h2>
            {results.top.length === 0 ? (
              <p className="mt-2 text-sm text-[var(--color-ink-muted)]">
                {t("growth.results.noRated")}
              </p>
            ) : (
              <ol className="mt-3 flex flex-col gap-2 text-sm">
                {results.top.map((p, i) => (
                  <li key={p.id} className="flex flex-wrap items-baseline gap-2">
                    <span className="w-6 text-right text-[var(--color-ink-muted)] tabular-nums">
                      {i + 1}.
                    </span>
                    <span className="font-medium tabular-nums text-[var(--color-accent)]">
                      {pct(p.rate)}
                    </span>
                    <Link
                      href={`/posts/${p.id}`}
                      className="text-[var(--color-ink)] underline hover:text-[var(--color-accent)]"
                    >
                      {p.hook || p.title || `#${p.id}`}
                    </Link>
                    <span className="text-xs text-[var(--color-ink-muted)]">
                      {p.format} · @{p.handle} · {formatDate(p.publishedAt, locale)} ·{" "}
                      {t("growth.results.reachN", {
                        n: (p.metrics?.reach ?? 0).toLocaleString("en-US"),
                      })}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <ResultsTable title={t("growth.results.byFormat")} groups={results.byFormat} t={t} />
          <ResultsTable title={t("growth.results.byAccount")} groups={results.byAccount} t={t} />
          <ResultsTable title={t("growth.results.byLanguage")} groups={results.byLanguage} t={t} />
          <ResultsTable title={t("growth.results.byMechanic")} groups={results.byMechanic} t={t} />
          <ResultsTable
            title={t("growth.results.byHook")}
            groups={results.byHook}
            t={t}
            labelOf={(k) => (k in HOOK_KEY ? t(HOOK_KEY[k as HookShape]) : k)}
          />

          <section className="mt-8">
            <h2 className="text-lg font-semibold text-[var(--color-ink)]">
              {t("growth.results.allPosts", { n: results.posts.length })}
            </h2>
            {results.posts.length === 0 ? (
              <p className="mt-2 text-sm text-[var(--color-ink-muted)]">
                {t("growth.results.noPosts")}
              </p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs text-[var(--color-ink-muted)]">
                    <tr>
                      <th className="py-1 pr-3 font-medium">{t("growth.results.published")}</th>
                      <th className="py-1 pr-3 font-medium">{t("growth.results.post")}</th>
                      <th className="py-1 pr-3 text-right font-medium">
                        {t("growth.results.rate")}
                      </th>
                      <th className="py-1 pr-3 text-right font-medium">
                        {t("growth.results.reach")}
                      </th>
                      <th className="py-1 text-right font-medium">{t("growth.results.likes")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.posts.slice(0, POST_TABLE_LIMIT).map((p) => (
                      <tr key={p.id} className="border-t border-[var(--color-border-subtle)]">
                        <td className="py-1.5 pr-3 whitespace-nowrap text-[var(--color-ink-muted)]">
                          {formatDate(p.publishedAt, locale)}
                        </td>
                        <td className="py-1.5 pr-3">
                          <Link
                            href={`/posts/${p.id}`}
                            className="text-[var(--color-ink)] hover:text-[var(--color-accent)]"
                          >
                            {p.title || p.hook || `#${p.id}`}
                          </Link>
                          <span className="text-xs text-[var(--color-ink-muted)]">
                            {" "}
                            · {p.format} · @{p.handle}
                          </span>
                        </td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{pct(rateOf(p))}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">
                          {p.metrics?.reach?.toLocaleString("en-US") ?? "—"}
                        </td>
                        <td className="py-1.5 text-right tabular-nums">
                          {p.metrics?.likes?.toLocaleString("en-US") ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}
