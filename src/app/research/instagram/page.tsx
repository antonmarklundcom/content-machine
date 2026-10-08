import type { Metadata } from "next";
import Link from "next/link";

import { IgCompetitorPosts } from "@/components/IgCompetitorPosts";
import { IgCompetitorTable } from "@/components/IgCompetitorTable";
import { isOwner } from "@/lib/auth/roles";
import { requireUser } from "@/lib/auth/session";
import { listBrands } from "@/lib/bridge/brands";
import { translator } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/server";
import {
  bestCompetitorPosts,
  competitorPostCounts,
  listIgAccounts,
  listIgCompetitors,
} from "@/lib/meta/discovery";

import { addIgCompetitorAction, syncIgCompetitorsAction } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: translator(await getLocale())("ig.title") };
}

const CHIP =
  "rounded-[var(--radius-sm)] px-3 py-1.5 text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]";
const CHIP_ON = `${CHIP} bg-[var(--color-accent)] text-[var(--color-accent-ink)]`;
const CHIP_OFF = `${CHIP} surface-border text-[var(--color-ink)] hover:border-[var(--color-accent)]`;
const BUTTON =
  "rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-3 py-1.5 text-xs font-medium text-[var(--color-accent-ink)]";
const INPUT =
  "surface-border rounded-[var(--radius-sm)] bg-transparent px-2 py-1.5 text-sm text-[var(--color-ink)]";

/**
 * `/research/instagram?brand=<id>` — the Instagram accounts a brand studies,
 * looked up through Business Discovery, and their best recent posts ranked
 * against each account's own median (PLAN.md §6.S21).
 */
export default async function IgCompetitorsPage({
  searchParams,
}: {
  searchParams: Promise<{ brand?: string }>;
}) {
  const [params, brands, locale, user, igAccounts] = await Promise.all([
    searchParams,
    listBrands(),
    getLocale(),
    requireUser(),
    listIgAccounts(),
  ]);
  const t = translator(locale);
  const owner = isOwner(user);
  const brand = brands.find((b) => b.id === params.brand) ?? brands[0];
  const competitors = brand ? await listIgCompetitors(brand.id) : [];
  const [counts, best] = await Promise.all([
    competitorPostCounts(competitors),
    brand ? bestCompetitorPosts(brand.id, { days: 30, limit: 12 }) : [],
  ]);
  const linked = igAccounts.some((a) => a.integrationId !== null && a.externalId !== null);

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <p className="text-xs font-medium tracking-widest text-[var(--color-accent)] uppercase">
        {t("ig.eyebrow")}
      </p>
      <h1 className="mt-1 text-2xl font-semibold text-[var(--color-ink)]">{t("ig.title")}</h1>
      <p className="mt-2 text-sm leading-relaxed text-[var(--color-ink-muted)]">{t("ig.intro")}</p>

      {!brand ? (
        <p className="mt-8 text-sm text-[var(--color-ink-muted)]">{t("ig.noBrands")}</p>
      ) : (
        <>
          <nav aria-label={t("ig.brand")} className="mt-6 flex flex-wrap gap-2">
            {brands.map((b) => (
              <a
                key={b.id}
                href={`/research/instagram?${new URLSearchParams({ brand: b.id })}`}
                aria-current={b.id === brand.id ? "page" : undefined}
                className={b.id === brand.id ? CHIP_ON : CHIP_OFF}
              >
                {b.name}
              </a>
            ))}
          </nav>

          <div className="mt-4 text-xs">
            <Link
              href="/research/instagram/report"
              className="underline text-[var(--color-ink-muted)] hover:text-[var(--color-accent)]"
            >
              {t("ig.toReport")}
            </Link>
          </div>

          {!linked ? (
            <p className="surface-border mt-4 rounded-[var(--radius-sm)] p-3 text-sm text-[var(--color-ink-muted)]">
              {t("ig.noConnection")}{" "}
              <Link href="/settings" className="underline hover:text-[var(--color-accent)]">
                Settings
              </Link>
            </p>
          ) : null}

          <section className="mt-8">
            <IgCompetitorTable
              competitors={competitors}
              counts={counts}
              canEdit={owner}
              t={t}
              locale={locale}
            />
            {owner ? (
              <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
                <form action={addIgCompetitorAction} className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="brandId" value={brand.id} />
                  <label className="flex flex-col gap-1 text-xs text-[var(--color-ink-muted)]">
                    {t("ig.add.handle")}
                    <input name="handle" required maxLength={200} className={INPUT} />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-[var(--color-ink-muted)]">
                    {t("ig.add.role")}
                    <select name="role" className={INPUT} defaultValue="competitor">
                      <option value="competitor">{t("ig.role.competitor")}</option>
                      <option value="inspiration">{t("ig.role.inspiration")}</option>
                    </select>
                  </label>
                  <button type="submit" className={BUTTON}>
                    {t("ig.add.submit")}
                  </button>
                </form>
                {competitors.length > 0 && linked ? (
                  <form action={syncIgCompetitorsAction}>
                    <input type="hidden" name="brandId" value={brand.id} />
                    <button type="submit" className={BUTTON}>
                      {t("ig.sync")}
                    </button>
                  </form>
                ) : null}
              </div>
            ) : null}
            <p className="mt-2 text-xs text-[var(--color-ink-muted)]">{t("ig.syncHint")}</p>
          </section>

          <section className="mt-10">
            <h2 className="text-lg font-semibold text-[var(--color-ink)]">{t("ig.best.title")}</h2>
            <IgCompetitorPosts posts={best} empty={t("ig.best.none")} t={t} locale={locale} />
          </section>
        </>
      )}
    </main>
  );
}
