import "server-only";
import { and, asc, eq, sql, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  brandFamilies,
  brandKits,
  brands,
  facts,
  type Brand,
  type BrandFamily,
  type BrandKit,
  type Fact,
} from "@/db/schema";

/**
 * Reads over brand families and brand kits (PLAN.md §1.40, §2). A family
 * groups brands that share facts, research and inspiration; no family is
 * special in code, so everything here takes the family as data.
 */

export type FamilyWithBrands = BrandFamily & { brands: Brand[] };

/** Every family, name-ordered. */
export async function listFamilies(): Promise<BrandFamily[]> {
  return db.select().from(brandFamilies).orderBy(asc(brandFamilies.name));
}

/** Every family with its brands (active or not), name-ordered at both levels. */
export async function listFamiliesWithBrands(): Promise<FamilyWithBrands[]> {
  const [families, members] = await Promise.all([
    listFamilies(),
    db.select().from(brands).orderBy(asc(brands.name)),
  ]);
  return families.map((family) => ({
    ...family,
    brands: members.filter((b) => b.familyId === family.id),
  }));
}

export async function getFamily(id: string): Promise<BrandFamily | null> {
  const [row] = await db.select().from(brandFamilies).where(eq(brandFamilies.id, id)).limit(1);
  return row ?? null;
}

/** A family's brands, name-ordered. `activeOnly` for pickers; history needs all. */
export async function listFamilyBrands(
  familyId: string,
  options: { activeOnly?: boolean } = {},
): Promise<Brand[]> {
  return db
    .select()
    .from(brands)
    .where(
      and(eq(brands.familyId, familyId), options.activeOnly ? eq(brands.active, true) : undefined),
    )
    .orderBy(asc(brands.name));
}

/**
 * Facts shared by a whole family (§1.48), optionally in one language, by topic
 * then key. Brand-scoped facts stay in `listFacts` (bridge/facts.ts).
 */
export async function listFamilyFacts(
  familyId: string,
  options: { language?: string; verifiedOnly?: boolean } = {},
): Promise<Fact[]> {
  return db
    .select()
    .from(facts)
    .where(
      and(
        eq(facts.familyId, familyId),
        options.language ? eq(facts.language, options.language) : undefined,
        options.verifiedOnly ? eq(facts.verified, true) : undefined,
      ),
    )
    .orderBy(
      asc(facts.topic),
      asc(sql`${facts.externalKey} is null`),
      asc(facts.externalKey),
      asc(facts.id),
    );
}

/** A brand's kit, or null when none has been made yet. */
export async function getBrandKit(brandId: string): Promise<BrandKit | null> {
  const [row] = await db.select().from(brandKits).where(eq(brandKits.brandId, brandId)).limit(1);
  return row ?? null;
}

/** Kits for several brands at once (e.g. every sibling in a family). */
export async function listBrandKits(brandIds: string[]): Promise<BrandKit[]> {
  if (brandIds.length === 0) return [];
  return db.select().from(brandKits).where(inArray(brandKits.brandId, brandIds));
}
