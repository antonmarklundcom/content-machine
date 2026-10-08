import type { Metadata } from "next";
import { HookAddForm, type HookScopeOption } from "@/components/HookAddForm";
import { HookRow } from "@/components/HookRow";
import { requireUser } from "@/lib/auth/session";
import { listAllBrands } from "@/lib/bridge/brands";
import { listFamilies } from "@/lib/bridge/families";
import { HOOK_KINDS, isHookKind, listHooks } from "@/lib/bridge/hooks";
import { translator } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: translator(await getLocale())("hooks.title") };
}

const CHIP =
  "rounded-[var(--radius-sm)] px-3 py-1.5 text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]";
const CHIP_ON = `${CHIP} bg-[var(--color-accent)] text-[var(--color-accent-ink)]`;
const CHIP_OFF = `${CHIP} surface-border text-[var(--color-ink)] hover:border-[var(--color-accent)]`;

type HooksSearchParams = { brand?: string; family?: string; kind?: string };

/** `/hooks?…` with one filter changed; brand and family exclude each other. */
function href(current: HooksSearchParams, change: HooksSearchParams): string {
  const next = { ...current, ...change };
  const params = new URLSearchParams();
  if (next.brand) params.set("brand", next.brand);
  else if (next.family) params.set("family", next.family);
  if (next.kind) params.set("kind", next.kind);
  const qs = params.toString();
  return qs ? `/hooks?${qs}` : "/hooks";
}

/**
 * The hooks library (S18): the `hook`, `cta` and `caption_pattern` lessons
 * post generation reads (§1.46), filtered by brand (its own plus its family's)
 * or family (shared plus every member's), with quick add and copy. Reuses
 * `lessons`; anyone signed in reads and writes, as on `/lessons`.
 */
export default async function HooksPage({
  searchParams,
}: {
  searchParams: Promise<HooksSearchParams>;
}) {
  const [params, , brands, families, locale] = await Promise.all([
    searchParams,
    requireUser(),
    listAllBrands(),
    listFamilies(),
    getLocale(),
  ]);
  const t = translator(locale);
  const brand = brands.find((b) => b.id === params.brand);
  const family = brand ? undefined : families.find((f) => f.id === params.family);
  const kind = isHookKind(params.kind) ? params.kind : undefined;
  const current: HooksSearchParams = { brand: brand?.id, family: family?.id, kind };

  const rows = await listHooks({ brandId: brand?.id, familyId: family?.id, kind });
  const brandNames = new Map(brands.map((b) => [b.id, b.name]));
  const familyNames = new Map(families.map((f) => [f.id, f.name]));
  const scopeLabel = (brandId: string | null, familyId: string | null) =>
    brandId
      ? t("hooks.scope.brand", { name: brandNames.get(brandId) ?? brandId })
      : familyId
        ? t("hooks.scope.family", { name: familyNames.get(familyId) ?? familyId })
        : t("hooks.scope.portfolio");

  const scopes: HookScopeOption[] = [
    { value: "", label: t("hooks.scope.portfolio") },
    ...families.map((f) => ({ value: `family:${f.id}`, label: scopeLabel(null, f.id) })),
    ...brands.map((b) => ({ value: `brand:${b.id}`, label: scopeLabel(b.id, null) })),
  ];

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <p className="text-xs font-medium tracking-widest text-[var(--color-accent)] uppercase">
        {t("hooks.eyebrow")}
      </p>
      <h1 className="mt-1 text-2xl font-semibold text-[var(--color-ink)]">{t("hooks.title")}</h1>
      <p className="mt-2 text-sm leading-relaxed text-[var(--color-ink-muted)]">
        {t("hooks.intro")}
      </p>

      <nav aria-label={t("hooks.field.kind")} className="mt-6 flex flex-wrap gap-2">
        {[undefined, ...HOOK_KINDS].map((k) => (
          <a
            key={k ?? "all"}
            href={href(current, { kind: k })}
            aria-current={k === kind ? "page" : undefined}
            className={k === kind ? CHIP_ON : CHIP_OFF}
          >
            {k ? t(`hooks.kind.${k}`) : t("hooks.all")}
          </a>
        ))}
      </nav>
      {families.length > 0 && (
        <nav aria-label={t("hooks.families")} className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-[var(--color-ink-muted)]">
            {t("hooks.families")}
          </span>
          <a
            href={href(current, { brand: undefined, family: undefined })}
            aria-current={!brand && !family ? "page" : undefined}
            className={!brand && !family ? CHIP_ON : CHIP_OFF}
          >
            {t("hooks.all")}
          </a>
          {families.map((f) => (
            <a
              key={f.id}
              href={href(current, { brand: undefined, family: f.id })}
              aria-current={f.id === family?.id ? "page" : undefined}
              className={f.id === family?.id ? CHIP_ON : CHIP_OFF}
            >
              {f.name}
            </a>
          ))}
        </nav>
      )}
      {brands.length > 0 && (
        <nav aria-label={t("hooks.brands")} className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-[var(--color-ink-muted)]">
            {t("hooks.brands")}
          </span>
          {brands.map((b) => (
            <a
              key={b.id}
              href={href(current, { brand: b.id, family: undefined })}
              aria-current={b.id === brand?.id ? "page" : undefined}
              className={b.id === brand?.id ? CHIP_ON : CHIP_OFF}
            >
              {b.name}
            </a>
          ))}
        </nav>
      )}

      <section className="surface-border surface-card mt-8 p-5">
        <HookAddForm
          key={`${brand?.id ?? ""}:${family?.id ?? ""}:${kind ?? ""}`}
          scopes={scopes}
          defaultScope={brand ? `brand:${brand.id}` : family ? `family:${family.id}` : ""}
          defaultKind={kind ?? "hook"}
          locale={locale}
        />
      </section>

      {rows.length === 0 ? (
        <p className="mt-8 text-sm text-[var(--color-ink-muted)]">{t("hooks.empty")}</p>
      ) : (
        <ul className="mt-8 flex flex-col gap-3">
          {rows.map((row) => (
            <HookRow
              key={row.id}
              locale={locale}
              hook={{
                id: row.id,
                text: row.text,
                kind: row.kind as (typeof HOOK_KINDS)[number],
                scope: scopeLabel(row.brandId, row.familyId),
              }}
            />
          ))}
        </ul>
      )}
    </main>
  );
}
