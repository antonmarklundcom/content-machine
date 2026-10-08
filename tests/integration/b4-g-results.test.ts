import { insertReturning } from "@/db/mutations";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";

import { eq } from "drizzle-orm";

import { db, schema } from "@/db";
import { fillPostLeadUrl, setKitLeadBase, setPostLeadUrl } from "@/lib/leads/store";
import { LeadUrlError } from "@/lib/leads/url";
import { loadResults } from "@/lib/results/load";

import { resetTables, teardown } from "./setup";

/**
 * Phase G results + lead links (build 4 §3.G): the dashboard reads the newest
 * snapshot per post, counts posts without metrics, and groups by format,
 * language, mechanic and hook; lead links are built from the kit base.
 */

const FROM = new Date("2026-07-01T00:00:00Z");
const TO = new Date("2026-09-30T00:00:00Z");

let ig = 0;
let fb = 0;
const ids: Record<string, number> = {};

function body(hook: string, mechanic: string) {
  return { version: 1, hook, engagement: { mechanic, detail: "x" } };
}

beforeEach(async () => {
  await resetTables();
  await db.insert(schema.brands).values({
    id: "residencia",
    name: "Residencia",
    domain: "r.com",
    niche: "residencia",
    market: "paraguay",
    language: "es",
    platforms: ["instagram", "facebook"],
  });
  const accs = await insertReturning(db, schema.socialAccounts, [
    { brandId: "residencia", platform: "instagram", handle: "residenciapy", language: "es-PY" },
    { brandId: "residencia", platform: "facebook", handle: "residenciafb" },
  ]);
  ig = accs[0].id;
  fb = accs[1].id;
  const rows = await insertReturning(db, schema.posts, [
    {
      accountId: ig,
      brandId: "residencia",
      format: "reel",
      status: "published",
      title: "A",
      body: body("¿Sabías esto?", "question"),
      publishedAt: new Date("2026-09-01T00:00:00Z"),
    },
    {
      accountId: ig,
      brandId: "residencia",
      format: "carousel",
      status: "published",
      title: "B",
      body: body("3 errores", "save"),
      publishedAt: new Date("2026-09-02T00:00:00Z"),
    },
    {
      accountId: fb,
      brandId: "residencia",
      format: "image_post",
      status: "published",
      title: "C no metrics",
      publishedAt: new Date("2026-09-03T00:00:00Z"),
    },
    {
      accountId: ig,
      brandId: "residencia",
      format: "reel",
      status: "published",
      title: "Too old",
      publishedAt: new Date("2026-01-01T00:00:00Z"),
    },
    { accountId: ig, brandId: "residencia", format: "reel", status: "drafting", title: "Draft" },
  ]);
  for (const r of rows) ids[r.title] = r.id;
  await db.insert(schema.postMetrics).values([
    // A: an older snapshot with a higher rate must lose to the newest one.
    { postId: ids.A, capturedAt: new Date("2026-09-02T00:00:00Z"), reach: 100, saves: 50 },
    {
      postId: ids.A,
      capturedAt: new Date("2026-09-10T00:00:00Z"),
      reach: 1000,
      saves: 30,
      comments: 20,
      likes: 70,
    },
    {
      postId: ids.B,
      capturedAt: new Date("2026-09-05T00:00:00Z"),
      reach: 200,
      saves: 20,
      shares: 10,
    },
    { postId: ids["Too old"], capturedAt: new Date("2026-09-05T00:00:00Z"), reach: 10, saves: 10 },
  ]);
  await db.insert(schema.accountMetrics).values([
    { accountId: ig, date: "2026-09-01", followers: 1000 },
    { accountId: ig, date: "2026-09-15", followers: 1100 },
    { accountId: ig, date: "2026-09-20", followers: null },
    { accountId: ig, date: "2026-05-01", followers: 500 },
  ]);
});

after(teardown);

test("loadResults: latest snapshot per post, posts without metrics counted, grouped", async () => {
  const r = await loadResults({ brandId: "residencia", from: FROM, to: TO });
  assert.deepEqual(
    r.posts.map((p) => p.title),
    ["C no metrics", "B", "A"],
  );
  const a = r.posts.find((p) => p.title === "A")!;
  assert.equal(a.metrics?.reach, 1000, "the newest snapshot wins");
  assert.equal(a.mechanic, "question");
  assert.equal(a.language, "es-PY");
  assert.equal(
    r.posts.find((p) => p.title === "C no metrics")!.language,
    "es",
    "brand language fallback",
  );

  assert.equal(r.totals.posts, 3);
  assert.equal(r.totals.measured, 2);
  assert.equal(r.totals.rated, 2);
  assert.deepEqual(
    r.top.map((p) => [p.title, Number(p.rate.toFixed(3))]),
    [
      ["B", 0.15],
      ["A", 0.05],
    ],
  );
  assert.deepEqual(
    r.byFormat.map((g) => g.key),
    ["carousel", "reel", "image_post"],
  );
  assert.deepEqual(r.byMechanic.map((g) => g.key).sort(), ["question", "save", "—"]);
  assert.deepEqual(r.byHook.map((g) => g.key).sort(), ["none", "number", "question"]);
  assert.equal(r.byLanguage.length, 2);

  assert.equal(r.followers.length, 1);
  assert.deepEqual(r.followers[0].trend.points, [
    { date: "2026-09-01", followers: 1000 },
    { date: "2026-09-15", followers: 1100 },
  ]);
  assert.equal(r.followers[0].trend.delta, 100);
});

test("loadResults: one account, and an empty range", async () => {
  const only = await loadResults({ brandId: "residencia", accountId: fb, from: FROM, to: TO });
  assert.deepEqual(
    only.posts.map((p) => p.title),
    ["C no metrics"],
  );
  assert.equal(only.top.length, 0);
  assert.equal(only.totals.avgRate, null);
  const none = await loadResults({
    brandId: "residencia",
    from: new Date("2025-01-01T00:00:00Z"),
    to: new Date("2025-02-01T00:00:00Z"),
  });
  assert.equal(none.posts.length, 0);
  assert.equal(none.followers.length, 0);
  const nobrand = await loadResults({ brandId: "nope", from: FROM, to: TO });
  assert.equal(nobrand.posts.length, 0);
});

test("lead links: kit base set, post link filled with UTMs, hand edit and validation", async () => {
  await assert.rejects(
    setPostLeadUrl(ids.A, "https://example.com/live-edit"),
    /confirmed or uncertain send/,
  );
  const [draft] = await insertReturning(db, schema.posts, {
    brandId: "residencia",
    accountId: ig,
    format: "carousel",
    title: "Lead link draft",
    status: "drafting",
  });
  await assert.rejects(fillPostLeadUrl(draft.id), LeadUrlError, "no base yet");
  await assert.rejects(setKitLeadBase("residencia", "not a url"), LeadUrlError);
  assert.equal(
    await setKitLeadBase("residencia", " https://crm.example.com/f/abc?lang=es#form "),
    "https://crm.example.com/f/abc?lang=es#form",
  );
  const url = await fillPostLeadUrl(draft.id, "Spring");
  assert.equal(
    url,
    `https://crm.example.com/f/abc?lang=es&utm_source=instagram&utm_medium=social&utm_campaign=spring&utm_content=post-${draft.id}#form`,
  );
  const [row] = await db.select().from(schema.posts).where(eq(schema.posts.id, draft.id));
  assert.equal(row.leadUrl, url);

  assert.equal(await setPostLeadUrl(draft.id, "https://example.com/x"), "https://example.com/x");
  assert.equal(await setPostLeadUrl(draft.id, ""), null);
  await assert.rejects(setPostLeadUrl(draft.id, "ftp://x"), LeadUrlError);
  await assert.rejects(setPostLeadUrl(999_999, "https://example.com"), LeadUrlError);

  // The kit row keeps its other fields when the base changes.
  await db
    .update(schema.brandKits)
    .set({ ctas: ["DM us"] })
    .where(eq(schema.brandKits.brandId, "residencia"));
  await setKitLeadBase("residencia", "");
  const [kit] = await db.select().from(schema.brandKits);
  assert.equal(kit.leadBaseUrl, null);
  assert.deepEqual(kit.ctas, ["DM us"]);
});
