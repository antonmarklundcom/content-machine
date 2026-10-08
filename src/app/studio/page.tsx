import Link from "next/link";
import { SCRIPT_STATUSES, type ScriptStatus } from "@/db/schema";
import { requireUser } from "@/lib/auth/session";
import { listBrands } from "@/lib/bridge";
import { listScripts } from "@/lib/bridge/scripts";
import { formatDate } from "@/lib/format";
import { getLocale } from "@/lib/i18n/server";
import { translator } from "@/lib/i18n";
import { STATUS_LABEL } from "./model";

const PILL =
  "surface-border rounded-full px-3 py-1 text-xs font-medium transition-colors hover:border-[var(--color-accent)]";

/** `/studio` — every script, filtered by brand and status (PLAN.md §6.S12.1). */
export default async function StudioPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireUser();
  const params = await searchParams;
  const locale = await getLocale();
  const t = translator(locale);

  const brands = await listBrands();
  const brand =
    typeof params.brand === "string" && brands.some((b) => b.id === params.brand)
      ? params.brand
      : undefined;
  const status =
    typeof params.status === "string" &&
    (SCRIPT_STATUSES as readonly string[]).includes(params.status)
      ? (params.status as ScriptStatus)
      : undefined;
  const scripts = await listScripts({ brandId: brand, status });
  const brandName = new Map(brands.map((b) => [b.id, b.name]));

  const href = (next: { brand?: string; status?: string }) => {
    const q = new URLSearchParams();
    if (next.brand) q.set("brand", next.brand);
    if (next.status) q.set("status", next.status);
    const s = q.toString();
    return s ? `/studio?${s}` : "/studio";
  };
  const pill = (active: boolean) =>
    `${PILL} ${active ? "border-[var(--color-accent)] text-[var(--color-ink)]" : "text-[var(--color-ink-muted)]"}`;

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium tracking-widest text-[var(--color-accent)] uppercase">
            {t("studio.title")}
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-[var(--color-ink)]">
            {scripts.length} {t(scripts.length === 1 ? "studio.countOne" : "studio.countMany")}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/studio/plan"
            className="text-sm font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-accent)]"
          >
            {t("publish.link.plan")}
          </Link>
          <Link
            href={brand ? `/studio/listing?brand=${encodeURIComponent(brand)}` : "/studio/listing"}
            className="surface-border rounded-[var(--radius-sm)] px-4 py-2 text-sm font-medium text-[var(--color-ink)] hover:border-[var(--color-accent)]"
          >
            {t("listing.link")}
          </Link>
          <Link
            href={brand ? `/studio/new?brand=${encodeURIComponent(brand)}` : "/studio/new"}
            className="rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-[var(--color-accent-ink)]"
          >
            {t("studio.new")}
          </Link>
        </div>
      </div>

      <nav aria-label={t("studio.filter.brand")} className="mb-3 flex flex-wrap gap-2">
        <Link href={href({ status })} className={pill(!brand)}>
          {t("studio.filter.allBrands")}
        </Link>
        {brands.map((b) => (
          <Link key={b.id} href={href({ brand: b.id, status })} className={pill(brand === b.id)}>
            {b.name}
          </Link>
        ))}
      </nav>
      <nav aria-label={t("studio.filter.status")} className="mb-6 flex flex-wrap gap-2">
        <Link href={href({ brand })} className={pill(!status)}>
          {t("studio.filter.allStatuses")}
        </Link>
        {SCRIPT_STATUSES.map((s) => (
          <Link key={s} href={href({ brand, status: s })} className={pill(status === s)}>
            {t(STATUS_LABEL[s])}
          </Link>
        ))}
      </nav>

      {scripts.length === 0 ? (
        <div className="surface-border surface-card flex min-h-[30vh] flex-col items-center justify-center gap-3 px-6 py-16 text-center">
          <h2 className="text-lg font-medium text-[var(--color-ink)]">
            {t(brand || status ? "studio.noMatch.title" : "studio.empty.title")}
          </h2>
          <p className="max-w-md text-sm leading-relaxed text-[var(--color-ink-muted)]">
            {t("studio.empty.body")}
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {scripts.map((s) => (
            <li key={s.id} className="surface-border surface-card px-5 py-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <Link
                  href={`/studio/${s.id}`}
                  className="text-sm font-medium text-[var(--color-ink)] hover:text-[var(--color-accent)]"
                >
                  {s.title}
                </Link>
                <span className="text-xs text-[var(--color-ink-muted)]">
                  <span className="font-medium text-[var(--color-ink)]">
                    {t(STATUS_LABEL[s.status])}
                  </span>
                  {" · "}
                  {brandName.get(s.brandId) ?? s.brandId}
                  {" · "}
                  {s.language}
                  {" · "}
                  {formatDate(s.updatedAt, locale)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
