import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, beforeEach, test } from "node:test";

import { and, eq } from "drizzle-orm";
import { workAsyncStorage } from "next/dist/server/app-render/work-async-storage.external.js";

import { db, schema } from "@/db";
import { listFamilyFacts } from "@/lib/bridge/families";
import { createLesson } from "@/lib/bridge/lessons";
import { createHook, deleteHook, listHooks } from "@/lib/bridge/hooks";
import { createHookAction, deleteHookAction, importFactsAction } from "@/lib/facts.actions";
import { factRowsFrom, FactsImportError, importFacts, parseFactsSource } from "@/lib/facts/import";

import { callRoute, signIn } from "./route";
import { resetTables, teardown } from "./setup";

/**
 * S18: the facts import (§1.48) against a fixture copy of paraguayresidency's
 * `content/shared/facts.ts`, and the hooks library over `lessons`.
 */

const FIXTURE = readFileSync(
  new URL("../fixtures/paraguayresidency-facts.ts.txt", import.meta.url),
  "utf8",
);
const FAMILY = { id: "paraguay-residency", name: "Paraguay residency" };
const BRAND = {
  id: "residency",
  name: "Paraguay Residency",
  domain: "paraguayresidency.co.uk",
  niche: "residency",
  market: "global",
  platforms: ["instagram"],
  familyId: FAMILY.id,
};
const OTHER = { ...BRAND, id: "elsewhere", name: "Elsewhere", domain: "e.com", familyId: null };

beforeEach(async () => {
  await resetTables();
  await db.insert(schema.brandFamilies).values(FAMILY);
  await db.insert(schema.brands).values([BRAND, OTHER]);
});
after(teardown);

/** Run a server action as a signed-in user (see research-ui.test.ts for why the store is patched). */
async function as<T>(role: "owner" | "employee", run: () => Promise<T>): Promise<T> {
  const { cookie } = await signIn(role, `${role}-${Math.random()}@example.com`);
  let value: T;
  await callRoute(
    async () => {
      const store = workAsyncStorage.getStore() as unknown as Record<string, unknown>;
      store.incrementalCache ??= {};
      value = await run();
      return new Response(null, { status: 204 });
    },
    new Request("http://localhost/facts", { method: "POST", headers: { cookie } }),
  );
  return value!;
}

// ---------------------------------------------------------------------------
// parsing
// ---------------------------------------------------------------------------

test("parse: the fixture's facts literal, one row per key × locale of the hedged text", () => {
  const source = parseFactsSource(FIXTURE);
  assert.equal(Object.keys(source).length, 5);
  const rows = factRowsFrom(source);
  // 3 facts hedged in en/es/pt/sv, 2 hedged as a plain (English) string.
  assert.equal(rows.length, 14);
  const launch = rows.filter((r) => r.externalKey === "investorpass.launch_date");
  assert.deepEqual(
    launch.map((r) => r.language),
    ["en"],
    "a plain-string hedge is English only — no English text filed under es/pt/sv",
  );
  const min = rows.find(
    (r) => r.externalKey === "investorpass.min_investment_usd" && r.language === "es",
  );
  assert.ok(min);
  assert.equal(min.claim, "desde un monto de inversión que confirmamos por escrito para tu caso");
  assert.equal(min.verified, false);
  assert.equal(min.topic, "investorpass");
  assert.match(min.sourceUrl ?? "", /^https:\/\/www\.mic\.gov\.py\//, "the sourced URL first");
  assert.equal(min.lastCheckedAt?.toISOString().slice(0, 10), "2026-09-26");
  assert.ok(!rows.some((r) => /\d{2},\d{3}|70\.000/.test(r.claim)), "no unverified figure leaks");
});

test("parse: a verified fact stores its display text; bad sources are refused", () => {
  const source = parseFactsSource(FIXTURE);
  const fact = { ...source["permanent.presence_rule"], verified: true, verifiedOn: "2026-10-01" };
  const rows = factRowsFrom({ [fact.key]: fact });
  assert.equal(rows.length, 4);
  assert.match(rows.find((r) => r.language === "en")?.claim ?? "", /^at least one entry/);
  assert.ok(rows.every((r) => r.verified));

  assert.throws(() => parseFactsSource("export const other = {};"), FactsImportError);
  assert.throws(() => parseFactsSource("export const facts = { key: 1 };"), FactsImportError);
  assert.throws(
    () => parseFactsSource('{"k": {"display": "x", "hedged": "y"}}'),
    /verified/,
    "every entry needs a boolean verified",
  );
  // A JSON file of the same object is accepted as-is.
  assert.equal(
    Object.keys(parseFactsSource('{"k": {"display": "x", "hedged": "y", "verified": false}}'))
      .length,
    1,
  );
});

// ---------------------------------------------------------------------------
// import
// ---------------------------------------------------------------------------

test("import: upserts into the family, re-runs as a no-op, and updates only what changed", async () => {
  const first = await importFacts(FAMILY.id, FIXTURE);
  assert.deepEqual(first, { keys: 5, rows: 14, inserted: 14, updated: 0, unchanged: 0 });

  const stored = await listFamilyFacts(FAMILY.id);
  assert.equal(stored.length, 14);
  assert.ok(stored.every((f) => f.brandId === null && f.verified === false));
  assert.deepEqual([...new Set(stored.map((f) => f.language))].sort(), ["en", "es", "pt", "sv"]);

  assert.deepEqual(await importFacts(FAMILY.id, FIXTURE), {
    keys: 5,
    rows: 14,
    inserted: 0,
    updated: 0,
    unchanged: 14,
  });

  const before = stored.find(
    (f) => f.externalKey === "permanent.presence_rule" && f.language === "sv",
  )!;
  const edited = FIXTURE.replace(
    "ett krav på minsta närvaro gäller",
    "ett krav på minsta närvaro gäller alltid",
  );
  const third = await importFacts(FAMILY.id, edited);
  assert.equal(third.updated, 1);
  assert.equal(third.unchanged, 13);
  const [after] = await db.select().from(schema.facts).where(eq(schema.facts.id, before.id));
  assert.match(after.claim, /gäller alltid/);
  assert.ok(after.updatedAt > before.updatedAt, "a new claim bumps updatedAt");

  // Brand-scoped hand-made facts are untouched by a family import.
  await db.insert(schema.facts).values({
    brandId: BRAND.id,
    topic: "own",
    claim: "Hand-made.",
    verified: true,
  });
  await importFacts(FAMILY.id, FIXTURE);
  const own = await db.select().from(schema.facts).where(eq(schema.facts.brandId, BRAND.id));
  assert.equal(own.length, 1);

  await assert.rejects(importFacts("no-such-family", FIXTURE), FactsImportError);
  assert.deepEqual(
    await importFacts(FAMILY.id, FIXTURE, { dryRun: true }),
    { keys: 5, rows: 14, inserted: 0, updated: 0, unchanged: 0 },
    "dry run writes nothing",
  );
});

test("import action: the owner imports an uploaded file; an employee is refused", async () => {
  const form = () => {
    const data = new FormData();
    data.set("family", FAMILY.id);
    data.set("file", new File([FIXTURE], "facts.ts", { type: "text/plain" }));
    return data;
  };
  assert.deepEqual(await as("employee", () => importFactsAction(null, form())), {
    ok: false,
    error: "facts.error.owner",
  });
  assert.equal((await listFamilyFacts(FAMILY.id)).length, 0);

  const ok = await as("owner", () => importFactsAction(null, form()));
  assert.deepEqual(ok, { ok: true, keys: 5, rows: 14, inserted: 14, updated: 0, unchanged: 0 });

  const noSource = new FormData();
  noSource.set("family", FAMILY.id);
  assert.deepEqual(await as("owner", () => importFactsAction(null, noSource)), {
    ok: false,
    error: "facts.error.source",
  });
  const bad = form();
  bad.set("file", new File(["export const x = 1;"], "facts.ts"));
  const refused = await as("owner", () => importFactsAction(null, bad));
  assert.equal(refused.ok, false);
  assert.equal(!refused.ok && refused.error, "facts.error.import");
});

// ---------------------------------------------------------------------------
// hooks library
// ---------------------------------------------------------------------------

test("hooks: brand and family filters, kind filter, and only hook kinds", async () => {
  const brandHook = await createHook({ text: "Brand hook", kind: "hook", brandId: BRAND.id });
  const familyCta = await createHook({ text: "Family CTA", kind: "cta", familyId: FAMILY.id });
  const otherHook = await createHook({ text: "Other hook", kind: "hook", brandId: OTHER.id });
  const global = await createHook({ text: "Everyone", kind: "caption_pattern" });
  const lesson = await createLesson({ text: "Not a hook", kind: "lesson", brandId: BRAND.id });

  const ids = (rows: { id: number }[]) => rows.map((r) => r.id).sort();
  assert.deepEqual(
    ids(await listHooks()),
    ids([brandHook, familyCta, otherHook, global]),
    "every hook-kind lesson, never a plain lesson",
  );
  assert.deepEqual(ids(await listHooks({ brandId: BRAND.id })), ids([brandHook, familyCta]));
  assert.deepEqual(ids(await listHooks({ familyId: FAMILY.id })), ids([brandHook, familyCta]));
  assert.deepEqual(ids(await listHooks({ brandId: OTHER.id })), ids([otherHook]));
  assert.deepEqual(ids(await listHooks({ familyId: FAMILY.id, kind: "cta" })), ids([familyCta]));

  assert.equal(await deleteHook(lesson.id), false, "a plain lesson is not deleted from /hooks");
  assert.equal(await deleteHook(global.id), true);
  await assert.rejects(
    createHook({ text: "x", kind: "hook", brandId: BRAND.id, familyId: FAMILY.id }),
    /not both/,
  );
});

test("hooks actions: quick add for a family, validation, delete", async () => {
  const data = new FormData();
  data.set("text", "  The one form everyone forgets  ");
  data.set("kind", "hook");
  data.set("scope", `family:${FAMILY.id}`);
  assert.deepEqual(await as("employee", () => createHookAction(null, data)), { ok: true });
  const [row] = await db
    .select()
    .from(schema.lessons)
    .where(and(eq(schema.lessons.familyId, FAMILY.id), eq(schema.lessons.kind, "hook")));
  assert.equal(row.text, "The one form everyone forgets");
  assert.equal(row.brandId, null);

  const badKind = new FormData();
  badKind.set("text", "x");
  badKind.set("kind", "lesson");
  assert.deepEqual(await as("employee", () => createHookAction(null, badKind)), {
    ok: false,
    error: "hooks.error.kind",
  });
  const badScope = new FormData();
  badScope.set("text", "x");
  badScope.set("kind", "cta");
  badScope.set("scope", "brand:nope");
  assert.deepEqual(await as("employee", () => createHookAction(null, badScope)), {
    ok: false,
    error: "hooks.error.scope",
  });

  assert.deepEqual(await as("employee", () => deleteHookAction(row.id)), { ok: true });
  assert.deepEqual(await as("employee", () => deleteHookAction(row.id)), {
    ok: false,
    error: "hooks.error.missing",
  });
});
