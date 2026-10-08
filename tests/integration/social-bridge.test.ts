import { insertReturning } from "@/db/mutations";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";

import { db, schema } from "@/db";
import { seedBrands, seedFamilies } from "@/db/seed";
import {
  countPostsByStatus,
  getAccount,
  getAsset,
  getAssetBySha256,
  getBrandKit,
  getPost,
  latestPostMetrics,
  listAccountMetrics,
  listAccounts,
  listAssetTags,
  listAssetUses,
  listAssets,
  listCalendarPosts,
  listClips,
  listCompetitorPosts,
  listDuePosts,
  listFamiliesWithBrands,
  listFamilyFacts,
  listIntegrations,
  listPostAssets,
  listPostMetrics,
  listPosts,
  listRelatedPosts,
  listSiblingAccounts,
  listSocialCompetitors,
} from "@/lib/bridge";
import { createFact } from "@/lib/bridge/facts";
import { sampleCarouselDraft } from "@/lib/posts/fixture";

import { resetTables, teardown } from "./setup";

/** The build 3 bridge readers (PLAN.md §5.O9.6) over seeded and inserted rows. */

beforeEach(async () => {
  await resetTables();
  await seedFamilies();
  await seedBrands();
  // A second family member, so family-level reads have something to span.
  await db.insert(schema.brands).values({
    id: "sibling",
    name: "Sibling",
    domain: "sibling.example",
    niche: "residency",
    market: "global",
    language: "es",
    platforms: ["instagram"],
    familyId: "paraguay-residency",
  });
});
after(teardown);

async function accounts() {
  return insertReturning(db, schema.socialAccounts, [
    { brandId: "guide", platform: "instagram", handle: "guide_en", status: "active" },
    { brandId: "sibling", platform: "instagram", handle: "sibling_es", status: "active" },
    { brandId: "sibling", platform: "tiktok", handle: "sibling_tt", status: "active" },
    { brandId: "propia", platform: "instagram", handle: "propia", status: "active" },
  ]);
}

test("families list their brands; kits and family facts read back", async () => {
  const families = await listFamiliesWithBrands();
  assert.deepEqual(
    families.map((f) => [f.id, f.brands.map((b) => b.id).sort()]),
    [
      [
        "paraguay-residency",
        [
          "flytta",
          "frontier",
          "guide",
          "investorpass",
          "residenciaes",
          "residenciapt",
          "residency",
          "sibling",
        ],
      ],
    ],
  );

  assert.equal(await getBrandKit("guide"), null);
  await db
    .insert(schema.brandKits)
    .values({ brandId: "guide", colors: [{ name: "Red", hex: "#f00" }] });
  const kit = await getBrandKit("guide");
  assert.deepEqual(kit?.colors, [{ name: "Red", hex: "#f00" }]);
  assert.deepEqual(kit?.higgsfield, { elementIds: [], characterIds: [], styleNotes: "" });

  await db.insert(schema.facts).values([
    { familyId: "paraguay-residency", externalKey: "a", language: "en", topic: "t", claim: "EN" },
    { familyId: "paraguay-residency", externalKey: "a", language: "es", topic: "t", claim: "ES" },
  ]);
  assert.deepEqual(
    (await listFamilyFacts("paraguay-residency", { language: "es" })).map((f) => f.claim),
    ["ES"],
  );
  assert.deepEqual(await listFamilyFacts("paraguay-residency", { verifiedOnly: true }), []);
});

test("a fact typed in by hand is verified and in its brand's language", async () => {
  const fact = await createFact("sibling", { topic: "visa", claim: "Un dato" });
  assert.equal(fact.verified, true);
  assert.equal(fact.language, "es");
  assert.equal(fact.familyId, null);
});

test("accounts resolve their brand's language and find their family siblings", async () => {
  const [guide, sibling] = await accounts();

  const account = await getAccount(guide.id);
  assert.equal(account?.brandName, "Paraguay Residency Guide");
  assert.equal(account?.effectiveLanguage, "en");
  assert.equal((await getAccount(sibling.id))?.effectiveLanguage, "es");

  assert.equal((await listAccounts({ familyId: "paraguay-residency" })).length, 3);
  assert.equal((await listAccounts({ brandId: "propia" })).length, 1);
  assert.deepEqual(
    (await listSiblingAccounts(guide.id)).map((a) => a.handle),
    ["sibling_es"],
    "same family, same platform, not itself",
  );

  await db.insert(schema.integrations).values({
    provider: "meta",
    label: "Meta",
    tokenCiphertext: "secret",
  });
  const [integration] = await listIntegrations("meta");
  assert.equal(integration.hasToken, true);
  assert.equal(
    "tokenCiphertext" in integration,
    false,
    "the token never leaves through the bridge",
  );
});

test("assets filter, dedupe by sha256 and report where they are used", async () => {
  const [account] = await accounts();
  const [a, b] = await insertReturning(db, schema.assets, [
    {
      brandId: "guide",
      kind: "image",
      mime: "image/png",
      bytes: 10,
      sha256: "a".repeat(64),
      source: "higgsfield",
      tags: ["hero", "visa"],
      status: "approved",
    },
    {
      kind: "video",
      mime: "video/mp4",
      bytes: 20,
      sha256: "b".repeat(64),
      source: "import",
      tags: ["visa"],
    },
  ]);

  assert.equal((await listAssets()).total, 2);
  assert.deepEqual(
    (await listAssets({ unsorted: true })).assets.map((x) => x.id),
    [b.id],
  );
  assert.deepEqual(
    (await listAssets({ tag: "hero" })).assets.map((x) => x.id),
    [a.id],
  );
  assert.equal(
    (await listAssets({ brandId: "guide", status: "approved", kind: "image" })).total,
    1,
  );
  assert.equal((await getAssetBySha256("A".repeat(64)))?.id, a.id);
  assert.equal((await getAsset(b.id))?.kind, "video");
  assert.deepEqual(await listAssetTags(), [
    { tag: "visa", count: 2 },
    { tag: "hero", count: 1 },
  ]);

  const [post] = await insertReturning(db, schema.posts, {
    accountId: account.id,
    brandId: "guide",
    format: "carousel",
    title: "P",
  });
  await db.insert(schema.postAssets).values([
    { postId: post.id, assetId: b.id, position: 1 },
    { postId: post.id, assetId: a.id, position: 0, role: "cover" },
  ]);
  assert.deepEqual(
    (await listPostAssets(post.id)).map((x) => [x.position, x.asset.id]),
    [
      [0, a.id],
      [1, b.id],
    ],
  );
  assert.deepEqual(
    (await listAssetUses(a.id)).map((u) => [u.postId, u.role]),
    [[post.id, "cover"]],
  );
});

test("posts list, calendar, family tree, due and counts", async () => {
  const [guide, sibling, , propia] = await accounts();
  const at = (d: string) => new Date(`2026-10-${d}T10:00:00.000Z`);
  const [root] = await insertReturning(db, schema.posts, {
    accountId: guide.id,
    brandId: "guide",
    format: "carousel",
    status: "scheduled",
    title: "Root",
    body: sampleCarouselDraft(),
    scheduledFor: at("05"),
  });
  const [child] = await insertReturning(db, schema.posts, {
    accountId: sibling.id,
    brandId: "sibling",
    format: "carousel",
    status: "published",
    title: "Child",
    parentPostId: root.id,
    scheduledFor: at("01"),
    publishedAt: at("06"),
  });
  await db.insert(schema.posts).values({
    accountId: propia.id,
    brandId: "propia",
    format: "reel",
    title: "Other",
  });

  const post = await getPost(root.id);
  assert.equal(post?.handle, "guide_en");
  assert.equal(post?.familyId, "paraguay-residency");
  assert.deepEqual(post?.body, sampleCarouselDraft());

  assert.equal((await listPosts()).total, 3);
  assert.equal((await listPosts({ familyId: "paraguay-residency" })).total, 2);
  assert.equal((await listPosts({ accountId: propia.id })).total, 1);
  assert.equal((await listPosts({ statuses: ["scheduled", "published"] })).total, 2);

  const october = await listCalendarPosts({ from: at("01"), to: at("31") });
  assert.deepEqual(
    october.map((p) => p.title),
    ["Root", "Child"],
    "dated by publishedAt, else scheduledFor; undated posts are left out",
  );

  assert.deepEqual(
    (await listRelatedPosts(root.id)).map((p) => p.id),
    [child.id],
  );
  assert.deepEqual(
    (await listRelatedPosts(child.id)).map((p) => p.id),
    [root.id],
  );

  assert.deepEqual((await listDuePosts(at("04"))).length, 0);
  assert.deepEqual(
    (await listDuePosts(at("05"))).map((p) => p.id),
    [root.id],
  );

  assert.deepEqual(
    await countPostsByStatus({ familyId: "paraguay-residency", from: at("01"), to: at("31") }),
    { scheduled: 1, published: 1 },
  );
});

test("metrics: snapshots, latest per post, account days, competitors", async () => {
  const [account] = await accounts();
  const [post] = await insertReturning(db, schema.posts, {
    accountId: account.id,
    brandId: "guide",
    format: "reel",
    title: "P",
  });
  await db.insert(schema.postMetrics).values([
    { postId: post.id, capturedAt: new Date("2026-10-01T00:00:00Z"), reach: 10 },
    { postId: post.id, capturedAt: new Date("2026-10-02T00:00:00Z"), reach: 25, saves: 3 },
  ]);
  assert.deepEqual(
    (await listPostMetrics(post.id)).map((m) => m.reach),
    [10, 25],
  );
  assert.deepEqual(
    (await latestPostMetrics([post.id, 999])).map((m) => m.reach),
    [25],
  );

  await db.insert(schema.accountMetrics).values([
    { accountId: account.id, date: "2026-10-01", followers: 100 },
    { accountId: account.id, date: "2026-10-02", followers: 110 },
  ]);
  assert.deepEqual(
    (await listAccountMetrics(account.id, { from: "2026-10-02" })).map((m) => m.followers),
    [110],
  );

  const [competitor] = await insertReturning(db, schema.socialCompetitors, {
    brandId: "guide",
    platform: "instagram",
    handle: "rival",
  });
  await db.insert(schema.competitorPosts).values([
    { competitorId: competitor.id, externalId: "1", postedAt: new Date("2026-09-01") },
    { competitorId: competitor.id, externalId: "2", postedAt: new Date("2026-09-10") },
  ]);
  assert.equal((await listSocialCompetitors({ brandId: "guide" })).length, 1);
  assert.deepEqual(
    (await listCompetitorPosts(competitor.id)).map((p) => p.externalId),
    ["2", "1"],
  );
});

test("the inbox filters on the capture fields", async () => {
  await db.insert(schema.clips).values([
    { url: "https://a.example/1", brandId: "guide", purpose: "fact_check", tags: ["visa"] },
    { url: "https://a.example/2", purpose: "inspo", source: "telegram" },
  ]);
  assert.equal((await listClips({ brandId: "guide" })).total, 1);
  assert.equal((await listClips({ purpose: "inspo" })).total, 1);
  assert.equal((await listClips({ tag: "visa" })).total, 1);
  assert.equal((await listClips()).total, 2);
});
