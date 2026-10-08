import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";

import { eq } from "drizzle-orm";

import { db, schema } from "@/db";
import { FAMILY_SEEDS, READY_BRAND_SEEDS, seedBrands, seedFamilies } from "@/db/seed";
import { getBrand, listAllBrands, listBrands, listFamilyBrands } from "@/lib/bridge";

import { resetTables, teardown } from "./setup";

/**
 * The seed and the brand reads over it (PLAN.md §5.O4.3).
 *
 * `vercel-build` runs `db:seed` on every deploy (§1.14), so "insert-only" is
 * not a style preference — it is the reason a deploy cannot quietly revert a
 * brand's voice to whatever this file said months ago. That guarantee is an
 * `on conflict do nothing` in real SQL, which is what this checks.
 */

beforeEach(resetTables);
after(teardown);

test("the first seed inserts every brand", async () => {
  const written = await seedBrands();

  assert.equal(written, READY_BRAND_SEEDS.length);
  assert.equal((await db.select().from(schema.brands)).length, READY_BRAND_SEEDS.length);
});

test("seeding twice writes nothing the second time", async () => {
  await seedBrands();
  const second = await seedBrands();

  assert.equal(second, 0, "a re-run reports 0, not 11");
  assert.equal((await db.select().from(schema.brands)).length, READY_BRAND_SEEDS.length);
});

test("a re-seed leaves edits made in the database alone", async () => {
  await seedBrands();
  await db
    .update(schema.brands)
    .set({ voice: "Tuned in the app, months after the seed was written." })
    .where(eq(schema.brands.id, "propia"));

  await seedBrands();

  const brand = await getBrand("propia");
  assert.equal(
    brand?.voice,
    "Tuned in the app, months after the seed was written.",
    "the database owns the row once it exists (§1.5)",
  );
});

test("--overwrite pushes the file back over the stored row, except `active`", async () => {
  await seedBrands();
  await db
    .update(schema.brands)
    .set({ voice: "edited", active: false })
    .where(eq(schema.brands.id, "propia"));

  await seedBrands({ overwrite: true });

  const brand = await getBrand("propia");
  assert.equal(brand?.voice, READY_BRAND_SEEDS.find((b) => b.id === "propia")?.voice);
  assert.equal(brand?.active, false, "deactivation is the app's switch, not seed data");
});

test("listBrands hides deactivated brands and listAllBrands does not", async () => {
  await seedBrands();
  await db.update(schema.brands).set({ active: false }).where(eq(schema.brands.id, "pozo"));

  const active = await listBrands();
  const all = await listAllBrands();

  assert.equal(all.length, READY_BRAND_SEEDS.length);
  assert.equal(active.length, READY_BRAND_SEEDS.length - 1);
  assert.ok(!active.some((b) => b.id === "pozo"));
  // A deactivated brand still has ideas attached, so history can still name it.
  assert.ok(all.some((b) => b.id === "pozo"));
});

test("both brand lists come back name-ordered", async () => {
  await seedBrands();

  const names = (await listAllBrands()).map((b) => b.name);
  assert.deepEqual(
    names,
    [...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
  );
});

test("getBrand returns null for a brand that does not exist", async () => {
  await seedBrands();

  assert.equal(await getBrand("no-such-brand"), null);
  assert.equal((await getBrand("contador"))?.name, "Contador.com.py");
});

test("every seeded brand round-trips its json platforms column", async () => {
  await seedBrands();

  for (const seeded of READY_BRAND_SEEDS) {
    const stored = await getBrand(seeded.id!);
    assert.deepEqual(stored?.platforms, seeded.platforms, `${seeded.id} platforms`);
  }
});

test("families seed insert-only, and the residency brands join theirs (§1.52)", async () => {
  assert.equal(await seedFamilies(), FAMILY_SEEDS.length);
  assert.equal(await seedFamilies(), 0, "a re-run writes nothing");
  await seedBrands();

  const members = await listFamilyBrands("paraguay-residency");
  assert.deepEqual(
    members.map((b) => b.id).sort(),
    ["flytta", "frontier", "guide", "investorpass", "residenciaes", "residenciapt", "residency"],
    "all seven residency brands are seeded",
  );
  assert.ok(
    members.every((b) => b.familyId === "paraguay-residency"),
    "every member points back at the family",
  );
  assert.equal(await getBrand("residency-guide"), null, "the build 2 id is gone from the seed");
});

test("no seed with a PENDING value is ever written", async () => {
  await seedBrands();
  const rows = await db.select().from(schema.brands);
  assert.ok(rows.every((b) => ![b.name, b.domain, b.niche].includes("PENDING")));
});
