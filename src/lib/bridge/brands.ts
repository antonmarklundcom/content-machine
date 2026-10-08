import "server-only";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { brands, type Brand } from "@/db/schema";

/**
 * Reads over `brands` — the app's single source of truth for which businesses
 * it writes for since PLAN.md §1.5 retired the hardcoded `BRANDS` constant.
 * Every caller that used to `import { BRANDS }` comes here instead, so there
 * is one answer to "which brands exist" rather than one per call site.
 */

/** Active brands, name-ordered — what the brand grid and the ideation prompt list. */
export async function listBrands(): Promise<Brand[]> {
  return db.select().from(brands).where(eq(brands.active, true)).orderBy(asc(brands.name));
}

/**
 * Every brand, active or not. A deactivated brand still has ideas attached to
 * it, so anything rendering history needs to be able to name it.
 */
export async function listAllBrands(): Promise<Brand[]> {
  return db.select().from(brands).orderBy(asc(brands.name));
}

/** One brand by slug, or null. Null covers both "never existed" and "deleted". */
export async function getBrand(id: string): Promise<Brand | null> {
  const rows = await db.select().from(brands).where(eq(brands.id, id)).limit(1);
  return rows[0] ?? null;
}
