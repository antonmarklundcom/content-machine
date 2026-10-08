import { insertIfAbsent, upsertReturning } from "@/db/mutations";
/**
 * Initial rows for the `brands` table — the app's single source of truth for
 * which businesses it writes for (PLAN.md §1.5). This file replaced the
 * hardcoded `BRANDS` constant that used to live in src/lib/brands.ts: nothing
 * at runtime reads this data, only the database.
 *
 * Usage: `npm run db:seed` (add `--overwrite` to push edits here back over the
 * stored rows).
 *
 * Idempotence, and why the default is insert-only: once a row exists, the
 * database — not this file — owns it. A brand's voice or platform list gets
 * tuned in place, and a seed run that re-applied these literals every time
 * would silently undo that tuning on the next deploy. So a re-run inserts what
 * is missing and leaves everything else exactly as it is; `--overwrite` is the
 * explicit opt-in for the other direction. Either way, `id` is the conflict
 * target, so a re-run can never duplicate a brand.
 */
import { pathToFileURL } from "node:url";

import { db, schema } from "./index";
import type { NewBrand, NewBrandFamily } from "./schema";

/** Families (PLAN.md §1.40, §1.52). Insert-only, like the brands. */
export const FAMILY_SEEDS: NewBrandFamily[] = [
  {
    id: "paraguay-residency",
    name: "Paraguay residency",
    notes: "One brand per language or angle; shares facts, research and inspiration.",
  },
];

/**
 * The seven Paraguay residency brands (§1.52), with the SiteKeys used in
 * `antonmarklundcom/paraguayresidency`. Domains, niches and voices come from
 * that repo (`CLAUDE.md` domain table, `plan.md` §11) — never inferred from a
 * brand name.
 *
 * `guide` is build 2's `residency-guide`, renamed by migration 0007; on an
 * existing database its row (and its tuned voice) is already there and this
 * entry is skipped.
 *
 * Values come from the paraguayresidency repo (CLAUDE.md domain table,
 * plan.md §11), filled in after the O9 session could not clone it.
 */
const RESIDENCY_FAMILY = "paraguay-residency";
const PENDING = "PENDING";

const RESIDENCY_BRANDS: NewBrand[] = [
  {
    id: "residency",
    name: "Paraguay Residency",
    domain: "paraguayresidency.co.uk",
    niche:
      "Done-for-you Paraguay residency services (temporary, permanent, cédula, tax residency, family); the hub brand, global English with a UK-friendly tone",
    market: "global",
    language: "en",
    voice:
      "Calm, competent service voice. Global English that makes British readers feel at home without excluding Americans. Fixed fees, nationality-specific checklists, honest about when the standard route is wrong.",
    platforms: ["instagram", "facebook"],
    familyId: RESIDENCY_FAMILY,
  },
  {
    id: "investorpass",
    name: "Paraguay Investor Pass",
    domain: "paraguayinvestorpass.com",
    niche:
      "Paraguay Investor Pass: direct permanent residency by qualifying investment (real estate, business, financial instruments, tourism) for investors, family offices and migration agents",
    market: "global",
    language: "en",
    voice:
      "Precise, premium advisory voice for investors. States that thresholds and rules are new and still moving; quotes figures only when verified; cost, timeline and exit options in writing before anything is filed.",
    platforms: ["instagram", "facebook"],
    familyId: RESIDENCY_FAMILY,
  },
  {
    id: "guide",
    name: "Paraguay Residency Guide",
    domain: "paraguayresidencyguide.com",
    niche: "Paraguay residency, citizenship path, relocation for foreigners",
    market: "global",
    language: "en",
    voice:
      "Trustworthy expat guide voice. Clear, step-by-step, myth-busting. Speaks to US/EU/expat audience considering Paraguay residency.",
    platforms: ["instagram", "tiktok", "youtube_shorts"],
    familyId: RESIDENCY_FAMILY,
  },
  {
    id: "frontier",
    name: "Paraguay Frontier",
    domain: "paraguayfrontier.com",
    niche:
      "Plan-B second residency in Paraguay for Americans, Canadians, Britons and Australians: residency and tax ID held in reserve, territorial tax, land or a small business",
    market: "global",
    language: "en",
    voice:
      "Skeptical, practical voice for people who have seen the golden-visa hype and want the catch stated. Presence rules explained honestly. Never says tax-free.",
    platforms: ["instagram", "facebook"],
    familyId: RESIDENCY_FAMILY,
  },
  {
    id: "residenciaes",
    name: "Residencia Paraguay",
    domain: "residenciaenparaguay.es",
    niche:
      "Residencia en Paraguay para españoles primero y latinoamericanos después (Argentina sobre todo): residencia temporal y permanente, cédula, ruta Mercosur, salida fiscal de España",
    market: "global",
    language: "es",
    voice:
      "Directo y cercano, tuteo, sin vueltas. Honorarios fijos en euros. Dice cuándo Paraguay no conviene. Temas fiscales de España siempre con 'confírmalo con tu asesor'.",
    platforms: ["instagram", "facebook"],
    familyId: RESIDENCY_FAMILY,
  },
  {
    id: "residenciapt",
    name: "Vida no Paraguai",
    domain: "vidanoparaguai.com",
    niche:
      "Morar no Paraguai para brasileiros: residência temporária e permanente, cédula, rota Mercosul, custo de vida, negócios, fronteira e impostos",
    market: "global",
    language: "pt-BR",
    voice:
      "Fala com um vizinho, de forma simples, em 'você'. Nunca promete imposto zero nem vende o Paraguai como paraíso; diz o que é pior que no Brasil para que o resto seja acreditado. Impostos no Brasil: 'confirme com seu contador'.",
    platforms: ["instagram", "facebook"],
    familyId: RESIDENCY_FAMILY,
  },
  {
    id: "flytta",
    name: "Flytta till Paraguay",
    domain: "flyttatillparaguay.se",
    niche:
      "Flytta till Paraguay för svenskar: uppehållstillstånd, cédula, skatt vid utflyttning, kostnader och vardag, berättat utifrån Antons egen flytt",
    market: "global",
    language: "sv",
    voice:
      "Anton's personal story: first person plural ('vi') allowed here only. Ärligt och utan skönmålning om vad som tar tid och kostar. Utflyttningsskatt alltid med 'stäm av med en skatterådgivare'.",
    platforms: ["instagram", "facebook"],
    familyId: RESIDENCY_FAMILY,
  },
];

export const BRAND_SEEDS: NewBrand[] = [
  {
    id: "propia",
    name: "Propia (real estate)",
    domain: "propia.com.py",
    niche: "Paraguay real estate listings, buying/investing for foreigners and locals",
    market: "paraguay",
    language: "es",
    voice: "Aspirational but concrete — real listings, real prices, real neighborhoods.",
    platforms: ["instagram", "tiktok", "facebook"],
  },
  {
    id: "contador",
    name: "Contador.com.py",
    domain: "contador.com.py",
    niche: "Accounting / facturación / IVA / RUC services in Paraguay",
    market: "paraguay",
    language: "es",
    voice: "Practical, deadline-driven, answers real tax/accounting pain points.",
    platforms: ["instagram", "facebook"],
  },
  {
    id: "negocio",
    name: "Negocio.com.py",
    domain: "negocio.com.py",
    niche: "Business directory / how to start & register a business in Paraguay",
    market: "paraguay",
    language: "es",
    voice: "Encouraging, entrepreneur-facing, directory-driven.",
    platforms: ["instagram", "facebook"],
  },
  {
    id: "obra",
    name: "Obra.com.py",
    domain: "obra.com.py",
    niche: "Construction / contractors / building in Paraguay",
    market: "paraguay",
    language: "es",
    voice: "Visual, before/after, trust-building for a high-stakes purchase.",
    platforms: ["instagram", "tiktok", "facebook"],
  },
  {
    id: "viaje",
    name: "Viaje.com.py",
    domain: "viaje.com.py",
    niche: "Travel in/to Paraguay",
    market: "paraguay",
    language: "es",
    voice: "Visual, inspirational, discovery-driven.",
    platforms: ["instagram", "tiktok"],
  },
  {
    id: "visas",
    name: "Visas.com.py",
    domain: "visas.com.py",
    niche: "Paraguay visas (distinct from residency guide — transactional/local angle)",
    market: "paraguay",
    language: "es",
    voice: "Direct, procedural, answers 'how do I get X visa' fast.",
    platforms: ["instagram", "facebook"],
  },
  {
    id: "pozo",
    name: "Pozo.com.py",
    domain: "pozo.com.py",
    niche: "Well drilling / water services",
    market: "paraguay",
    language: "es",
    voice: "Rural/practical trust-building, visible proof of work.",
    platforms: ["facebook", "instagram"],
  },
  {
    id: "clientes",
    name: "Clientes.com.py",
    domain: "clientes.com.py",
    niche: "Lead-gen / marketing services for Paraguayan businesses",
    market: "paraguay",
    language: "es",
    voice: "Results-first, case-study driven — this brand sells marketing itself.",
    platforms: ["instagram", "linkedin", "facebook"],
  },
  {
    id: "sitiosweb",
    name: "SitiosWeb.com.py",
    domain: "sitiosweb.com.py",
    niche: "Website design/build services for Paraguayan businesses",
    market: "paraguay",
    language: "es",
    voice: "Before/after site transforms, fast turnaround proof.",
    platforms: ["instagram", "linkedin", "facebook"],
  },
  {
    id: "contenido",
    name: "Contenido.com.py",
    domain: "contenido.com.py",
    niche: "Content/social media services for Paraguayan businesses",
    market: "paraguay",
    language: "es",
    voice: "Meta-content — showcases this very pipeline's output as proof of skill.",
    platforms: ["instagram", "tiktok", "linkedin"],
  },
  ...RESIDENCY_BRANDS,
];

/** A seed with any PENDING value is skipped, never written (see RESIDENCY_BRANDS). */
export function isPendingSeed(brand: NewBrand): boolean {
  return [brand.name, brand.domain, brand.niche].includes(PENDING);
}

/** The seeds a run actually writes. */
export const READY_BRAND_SEEDS: NewBrand[] = BRAND_SEEDS.filter((b) => !isPendingSeed(b));

/**
 * Insert every missing brand. Returns how many rows the run actually wrote, so
 * a second run visibly reports 0 rather than claiming to have "seeded 11".
 *
 * `active` is deliberately left out of the overwrite set: it is a switch the
 * app flips, not seed data, and restoring a brand someone deactivated is the
 * one edit an overwrite has no business making.
 */
export async function seedBrands(options: { overwrite?: boolean } = {}): Promise<number> {
  let written = 0;

  for (const brand of READY_BRAND_SEEDS) {
    const config = { target: schema.brands.id };
    const rows = options.overwrite
      ? await upsertReturning(
          db,
          schema.brands,
          brand,
          {
            ...config,
            set: {
              name: brand.name,
              domain: brand.domain,
              niche: brand.niche,
              market: brand.market,
              language: brand.language,
              voice: brand.voice,
              platforms: brand.platforms,
              familyId: brand.familyId ?? null,
            },
          },
          { id: schema.brands.id },
        )
      : await insertIfAbsent(db, schema.brands, brand, config, { id: schema.brands.id });
    written += rows.length;
  }

  return written;
}

/** Insert every missing family; returns how many were new. Insert-only. */
export async function seedFamilies(): Promise<number> {
  let written = 0;
  for (const family of FAMILY_SEEDS) {
    const rows = await insertIfAbsent(
      db,
      schema.brandFamilies,
      family,
      { target: schema.brandFamilies.id },
      { id: schema.brandFamilies.id },
    );
    written += rows.length;
  }
  return written;
}

// Only run when invoked as a script (`npm run db:seed`), so importing
// BRAND_SEEDS from a test or another script does not hit the database.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const overwrite = process.argv.includes("--overwrite");
  // Families first, so no brand ever points at a family that is not there yet.
  const families = await seedFamilies();
  console.log(
    `Seeded ${FAMILY_SEEDS.length} families (${families} new, ${FAMILY_SEEDS.length - families} already present).`,
  );
  const written = await seedBrands({ overwrite });
  const ready = READY_BRAND_SEEDS.length;
  console.log(
    overwrite
      ? `Seeded ${ready} brands (${written} inserted or updated).`
      : `Seeded ${ready} brands (${written} new, ${ready - written} already present and left untouched).`,
  );
  const pending = BRAND_SEEDS.filter(isPendingSeed).map((b) => b.id);
  if (pending.length) {
    console.warn(
      `Skipped ${pending.length} brands with PENDING seed values: ${pending.join(", ")}.`,
    );
  }
  process.exit(0);
}
