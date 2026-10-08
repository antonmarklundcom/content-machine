import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";

import { createPool, type RowDataPacket } from "mysql2/promise";
import { db, schema } from "@/db";
import { databaseOptions } from "@/db/driver";
import { eq } from "drizzle-orm";
import { resetTables, teardown } from "./setup";

/** Native MariaDB baseline schema checks (the old PostgreSQL upgrade fixtures no longer apply). */
beforeEach(resetTables);
const pool = createPool(databaseOptions(process.env.DATABASE_URL));
after(async () => {
  await pool.end();
  await teardown();
});

test("the converted baseline contains the social publishing tables", async () => {
  const expected = [
    "brand_families",
    "brand_kits",
    "social_accounts",
    "integrations",
    "assets",
    "posts",
    "post_assets",
    "post_metrics",
    "account_metrics",
    "social_competitors",
    "competitor_posts",
  ];
  const found = await db.select().from(schema.brands).limit(0);
  assert.equal(found.length, 0, "the baseline is queryable without requiring seeded brand rows");
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT TABLE_NAME AS name FROM information_schema.tables WHERE TABLE_SCHEMA = DATABASE()",
  );
  const names = new Set(rows.map((row) => row.name));
  for (const table of expected)
    assert.ok(names.has(table), `${table} exists in the MariaDB baseline`);
});

test("family facts are unique per external key and language; hand-made facts remain repeatable", async () => {
  await db.insert(schema.facts).values([
    {
      familyId: "family-fixture",
      externalKey: "visa.minimum",
      language: "en",
      topic: "visa",
      claim: "Claim",
    },
    {
      familyId: "family-fixture",
      externalKey: "visa.minimum",
      language: "es",
      topic: "visa",
      claim: "Afirmación",
    },
  ]);
  await assert.rejects(
    db.insert(schema.facts).values({
      familyId: "family-fixture",
      externalKey: "visa.minimum",
      language: "en",
      topic: "visa",
      claim: "Duplicate",
    }),
    /facts_family_key_language_idx/,
  );

  await db.insert(schema.facts).values([
    { brandId: "manual-fixture", topic: "tax", claim: "Same manual claim" },
    { brandId: "manual-fixture", topic: "tax", claim: "Same manual claim" },
  ]);
  const manual = await db
    .select()
    .from(schema.facts)
    .where(eq(schema.facts.brandId, "manual-fixture"));
  assert.equal(manual.length, 2, "the nullable external key leaves hand-made rows unconstrained");
});
