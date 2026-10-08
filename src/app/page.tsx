import Link from "next/link";
import type { Brand } from "@/db/schema";
import {
  countPostsByStatus,
  listBrands,
  listFamiliesWithBrands,
  type PostsQuery,
} from "@/lib/bridge";
import { getTranslator } from "@/lib/i18n/server";

// Families, brands and post counts come from the database on every request —
// nothing here can be prerendered at build time on a machine with no
// DATABASE_URL, and a post scheduled a minute ago should count.
export const dynamic = "force-dynamic";

/** Monday 00:00 UTC of the current week and the Monday after: the [from, to) the cards count. */
function thisWeek(now: Date): { from: Date; to: Date } {
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  from.setUTCDate(from.getUTCDate() - ((from.getUTCDay() + 6) % 7));
  const to = new Date(from);
  to.setUTCDate(to.getUTCDate() + 7);
  return { from, to };
}

const day = (d: Date) => d.toISOString().slice(0, 10);

const CARD = "surface-border surface-card flex flex-col gap-4 p-5";
const CHIP =
  "surface-border inline-flex w-fit items-center rounded-[var(--radius-sm)] bg-[var(--color-surface)] px-2 py-0.5 text-xs text-[var(--color-ink-muted)] hover:border-[var(--color-accent)] hover:text-[var(--color-ink)]";
const ACTION =
  "text-xs font-medium text-[var(--color-accent)] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]";

/** Home (PLAN.md §6.S20): one card per family with this week's scheduled and posted counts. */
export default async function HomePage() {
  const week = thisWeek(new Date());
  const [families, activeBrands, t] = await Promise.all([
    listFamiliesWithBrands(),
    listBrands(),
    getTranslator(),
  ]);
  const count = async (scope: Omit<PostsQuery, "page" | "status" | "statuses" | "from" | "to">) => {
    const byStatus = await countPostsByStatus({ ...scope, ...week });
    return { scheduled: byStatus.scheduled ?? 0, posted: byStatus.published ?? 0 };
  };

  const familyCards = await Promise.all(
    families.map(async (family) => ({
      family,
      brands: family.brands.filter((b) => b.active),
      counts: await count({ familyId: family.id }),
    })),
  );
  // Active brands outside every family still need a way in: one card each.
  // (A family id that names no family row counts as none.)
  const familyIds = new Set(families.map((f) => f.id));
  const loose = activeBrands.filter((b) => !b.familyId || !familyIds.has(b.familyId));
  const brandCards = await Promise.all(
    loose.map(async (brand) => ({ brand, counts: await count({ brandId: brand.id }) })),
  );

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-ink)]">
        {t("home.title")}
      </h1>
      <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
        {t("home.intro", {
          from: day(week.from),
          to: day(new Date(week.to.getTime() - 86_400_000)),
        })}
      </p>

      {families.length === 0 && (
        <p className="mt-6 text-sm text-[var(--color-ink-muted)]">
          {t("home.noFamilies")}{" "}
          <Link href="/families" className={ACTION}>
            {t("home.manageFamilies")}
          </Link>
        </p>
      )}

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {familyCards.map(({ family, brands, counts }) => (
          <section key={family.id} className={CARD} aria-labelledby={`family-${family.id}`}>
            <h2
              id={`family-${family.id}`}
              className="text-base font-semibold text-[var(--color-ink)]"
            >
              {family.name}
            </h2>
            <Counts counts={counts} scheduled={t("home.scheduled")} posted={t("home.posted")} />
            <BrandChips brands={brands} empty={t("home.noBrands")} />
            <div className="flex flex-wrap gap-4">
              <Link
                href={`/calendar?view=week&family=${encodeURIComponent(family.id)}`}
                className={ACTION}
              >
                {t("home.calendar")}
              </Link>
              <Link href="/posts/new" className={ACTION}>
                {t("home.newPost")}
              </Link>
            </div>
          </section>
        ))}
      </div>

      {brandCards.length > 0 && (
        <>
          <h2 className="mt-10 text-sm font-semibold tracking-wide text-[var(--color-ink-muted)] uppercase">
            {t("home.unfamilied")}
          </h2>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {brandCards.map(({ brand, counts }) => (
              <section key={brand.id} className={CARD}>
                <div>
                  <Link
                    href={`/brand/${brand.id}`}
                    className="text-base font-semibold text-[var(--color-ink)] hover:text-[var(--color-accent)]"
                  >
                    {brand.name}
                  </Link>
                  <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{brand.niche}</p>
                </div>
                <Counts counts={counts} scheduled={t("home.scheduled")} posted={t("home.posted")} />
              </section>
            ))}
          </div>
        </>
      )}
    </main>
  );
}

function Counts({
  counts,
  scheduled,
  posted,
}: {
  counts: { scheduled: number; posted: number };
  scheduled: string;
  posted: string;
}) {
  return (
    <dl className="grid grid-cols-2 gap-2">
      {(
        [
          [scheduled, counts.scheduled],
          [posted, counts.posted],
        ] as const
      ).map(([label, n]) => (
        <div key={label}>
          <dt className="text-xs text-[var(--color-ink-muted)]">{label}</dt>
          <dd className="text-2xl font-semibold tabular-nums text-[var(--color-ink)]">{n}</dd>
        </div>
      ))}
    </dl>
  );
}

function BrandChips({ brands, empty }: { brands: Brand[]; empty: string }) {
  if (brands.length === 0) return <p className="text-xs text-[var(--color-ink-muted)]">{empty}</p>;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {brands.map((b) => (
        <li key={b.id}>
          <Link href={`/brand/${b.id}`} className={CHIP}>
            {b.name}
          </Link>
        </li>
      ))}
    </ul>
  );
}
