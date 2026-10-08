import type { Metadata } from "next";
import { FactAddForm } from "@/components/FactAddForm";
import { FactCorrections } from "@/components/FactCorrections";
import { FactImportForm } from "@/components/FactImportForm";
import { FactRow } from "@/components/FactRow";
import { isOwner } from "@/lib/auth/roles";
import { requireUser } from "@/lib/auth/session";
import { listBrands } from "@/lib/bridge/brands";
import { brandScriptsNeedingCorrection, listFactsByTopic } from "@/lib/bridge/facts";
import { listFamilies, listFamilyFacts } from "@/lib/bridge/families";
import { translator } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/server";
import { isFactStale, STALE_AFTER_DAYS } from "@/lib/studio/staleness";
import type { Fact } from "@/db/schema";
import type { FactRowData } from "@/components/FactRow";

export async function generateMetadata(): Promise<Metadata> {
  return { title: translator(await getLocale())("facts.title") };
}

const CHIP =
  "rounded-[var(--radius-sm)] px-3 py-1.5 text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]";
const CHIP_ON = `${CHIP} bg-[var(--color-accent)] text-[var(--color-accent-ink)]`;
const CHIP_OFF = `${CHIP} surface-border text-[var(--color-ink)] hover:border-[var(--color-accent)]`;

type FactsSearchParams = { brand?: string; family?: string; lang?: string };

function toRow(fact: Fact, now: Date): FactRowData {
  return {
    id: fact.id,
    topic: fact.topic,
    claim: fact.claim,
    sourceUrl: fact.sourceUrl,
    notes: fact.notes,
    lastCheckedAt: fact.lastCheckedAt.toISOString(),
    stale: isFactStale(fact.lastCheckedAt, now),
    verified: fact.verified,
    ...(fact.familyId ? { language: fact.language, externalKey: fact.externalKey } : {}),
  };
}

function byTopic(facts: Fact[]): Array<{ topic: string; facts: Fact[] }> {
  const groups: Array<{ topic: string; facts: Fact[] }> = [];
  for (const fact of facts) {
    const last = groups.at(-1);
    if (last && last.topic === fact.topic) last.facts.push(fact);
    else groups.push({ topic: fact.topic, facts: [fact] });
  }
  return groups;
}

/**
 * A brand's fact sheet (build 2b, idea 3): checked facts grouped by topic, a
 * stale badge past 90 days, and the posted videos a changed fact may have made
 * wrong. `?brand=` picks the brand. Anyone signed in reads; the owner writes.
 *
 * S18 (§1.48): `?family=` shows a family's shared, imported facts instead
 * (`&lang=` narrows to one language), each unverified one badged, and the
 * owner gets the "Import facts" form.
 */
export default async function FactsPage({
  searchParams,
}: {
  searchParams: Promise<FactsSearchParams>;
}) {
  const [params, user, brands, families, locale] = await Promise.all([
    searchParams,
    requireUser(),
    listBrands(),
    listFamilies(),
    getLocale(),
  ]);
  const t = translator(locale);
  const family = families.find((f) => f.id === params.family);
  const brand = family ? undefined : (brands.find((b) => b.id === params.brand) ?? brands[0]);
  const canEdit = isOwner(user);

  const [groups, flagged] = brand
    ? await Promise.all([listFactsByTopic(brand.id), brandScriptsNeedingCorrection(brand.id)])
    : [[], []];
  const familyFacts = family ? await listFamilyFacts(family.id) : [];
  const languages = [...new Set(familyFacts.map((f) => f.language))].sort();
  const lang = params.lang && languages.includes(params.lang) ? params.lang : undefined;
  const familyGroups = byTopic(lang ? familyFacts.filter((f) => f.language === lang) : familyFacts);
  const topics = groups.map((g) => g.topic);
  const now = new Date();

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <p className="text-xs font-medium tracking-widest text-[var(--color-accent)] uppercase">
        {t("facts.eyebrow")}
      </p>
      <h1 className="mt-1 text-2xl font-semibold text-[var(--color-ink)]">{t("facts.title")}</h1>
      <p className="mt-2 text-sm leading-relaxed text-[var(--color-ink-muted)]">
        {t("facts.intro")}
      </p>

      {brands.length > 0 && (
        <nav aria-label={t("facts.brand")} className="mt-6 flex flex-wrap gap-2">
          {brands.map((b) => (
            <a
              key={b.id}
              href={`/facts?${new URLSearchParams({ brand: b.id })}`}
              aria-current={b.id === brand?.id ? "page" : undefined}
              className={b.id === brand?.id ? CHIP_ON : CHIP_OFF}
            >
              {b.name}
            </a>
          ))}
        </nav>
      )}
      {families.length > 0 && (
        <nav aria-label={t("facts.families")} className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-[var(--color-ink-muted)]">
            {t("facts.families")}
          </span>
          {families.map((f) => (
            <a
              key={f.id}
              href={`/facts?${new URLSearchParams({ family: f.id })}`}
              aria-current={f.id === family?.id ? "page" : undefined}
              className={f.id === family?.id ? CHIP_ON : CHIP_OFF}
            >
              {f.name}
            </a>
          ))}
        </nav>
      )}

      {canEdit && (family || !brand) && (
        <section className="surface-border surface-card mt-8 p-5">
          <FactImportForm
            families={families.map((f) => ({ id: f.id, name: f.name }))}
            familyId={family?.id}
            locale={locale}
          />
        </section>
      )}

      {family ? (
        <>
          <p className="mt-6 text-sm text-[var(--color-ink-muted)]">{t("facts.familyIntro")}</p>
          {languages.length > 1 && (
            <nav aria-label={t("facts.language")} className="mt-4 flex flex-wrap gap-2">
              {[undefined, ...languages].map((l) => (
                <a
                  key={l ?? "all"}
                  href={`/facts?${new URLSearchParams(l ? { family: family.id, lang: l } : { family: family.id })}`}
                  aria-current={l === lang ? "page" : undefined}
                  className={l === lang ? CHIP_ON : CHIP_OFF}
                >
                  {l ? l.toUpperCase() : t("facts.allLanguages")}
                </a>
              ))}
            </nav>
          )}
          {familyGroups.length === 0 ? (
            <p className="mt-8 text-sm text-[var(--color-ink-muted)]">{t("facts.empty")}</p>
          ) : (
            familyGroups.map((group) => (
              <section key={group.topic} className="mt-8">
                <h2 className="text-lg font-semibold text-[var(--color-ink)]">{group.topic}</h2>
                <ul className="mt-3 flex flex-col gap-3">
                  {group.facts.map((fact) => (
                    <FactRow
                      key={fact.id}
                      fact={toRow(fact, now)}
                      topics={[]}
                      canEdit={canEdit}
                      staleDays={STALE_AFTER_DAYS}
                      locale={locale}
                    />
                  ))}
                </ul>
              </section>
            ))
          )}
        </>
      ) : !brand ? (
        <p className="mt-8 text-sm text-[var(--color-ink-muted)]">{t("facts.noBrands")}</p>
      ) : (
        <>
          <section className="mt-8">
            <h2 className="text-lg font-semibold text-[var(--color-ink)]">
              {t("facts.corrections")}
            </h2>
            <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
              {t("facts.correctionsNote")}
            </p>
            <FactCorrections flagged={flagged} locale={locale} />
          </section>

          <section className="surface-border surface-card mt-10 p-5">
            {canEdit ? (
              <FactAddForm key={brand.id} brandId={brand.id} topics={topics} locale={locale} />
            ) : (
              <p className="text-sm text-[var(--color-ink-muted)]">{t("facts.ownerOnly")}</p>
            )}
          </section>

          {groups.length === 0 ? (
            <p className="mt-8 text-sm text-[var(--color-ink-muted)]">{t("facts.empty")}</p>
          ) : (
            groups.map((group) => (
              <section key={group.topic} className="mt-8">
                <h2 className="text-lg font-semibold text-[var(--color-ink)]">{group.topic}</h2>
                <ul className="mt-3 flex flex-col gap-3">
                  {group.facts.map((fact) => (
                    <FactRow
                      key={fact.id}
                      fact={toRow(fact, now)}
                      topics={topics}
                      canEdit={canEdit}
                      staleDays={STALE_AFTER_DAYS}
                      locale={locale}
                    />
                  ))}
                </ul>
              </section>
            ))
          )}
        </>
      )}
    </main>
  );
}
