import { insertReturning } from "@/db/mutations";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, beforeEach, test } from "node:test";

import { db, schema } from "@/db";
import {
  saveAccountAction,
  saveBrandAction,
  saveFamilyAction,
  saveKitAction,
  setAccountStatusAction,
} from "@/lib/accounts.actions";
import {
  getBrand,
  getBrandKit,
  getFamily,
  listAccounts,
  listAllBrands,
  listFamiliesWithBrands,
} from "@/lib/bridge";

import { callRoute, signIn } from "./route";
import { resetTables, teardown } from "./setup";

/**
 * S13's server actions (PLAN.md §6.S13): a family, a brand in it, an account
 * and a kit created through the UI's actions, plus the refusals — employee
 * writes, immutable ids, bad slugs, handle clashes, bad hex, a foreign logo.
 * Same `as()` harness as lessons-ui.test.ts.
 */

const { workAsyncStorage } = createRequire(import.meta.url)(
  "next/dist/server/app-render/work-async-storage.external",
) as { workAsyncStorage: { getStore(): Record<string, unknown> | undefined } };

async function as<T>(cookie: string, action: () => Promise<T>): Promise<T> {
  let result: T | undefined;
  let error: unknown;
  await callRoute(
    async () => {
      workAsyncStorage.getStore()!.incrementalCache = {};
      try {
        result = await action();
      } catch (e) {
        error = e;
      }
      return new Response(null);
    },
    new Request("http://localhost/brands", { method: "POST", headers: { cookie } }),
  );
  if (error) throw error;
  return result as T;
}

function form(fields: Record<string, string | string[] | undefined>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) data.append(name, v);
  }
  return data;
}

const FAMILY = { mode: "create", id: "test-family", name: "Test family", notes: "Shared facts" };
const BRAND = {
  mode: "create",
  id: "test-brand",
  name: "Test Brand",
  domain: "test.example",
  niche: "residency",
  market: "paraguay",
  language: "es",
  voice: "Warm, direct.",
  platforms: ["instagram", "tiktok", "not-a-platform"],
  familyId: "test-family",
  active: "on",
};

let owner = "";
let employee = "";

beforeEach(async () => {
  await resetTables();
  owner = (await signIn("owner")).cookie;
  employee = (await signIn("employee")).cookie;
});
after(teardown);

async function seedBrand() {
  assert.deepEqual(await as(owner, () => saveFamilyAction(null, form(FAMILY))), {
    ok: true,
    id: "test-family",
  });
  assert.deepEqual(await as(owner, () => saveBrandAction(null, form(BRAND))), {
    ok: true,
    id: "test-brand",
  });
}

test("the owner creates a family, a brand in it, an account and a kit", async () => {
  await seedBrand();

  const family = await getFamily("test-family");
  assert.equal(family?.name, "Test family");
  assert.equal(family?.notes, "Shared facts");
  const brand = await getBrand("test-brand");
  assert.equal(brand?.familyId, "test-family");
  assert.deepEqual(brand?.platforms, ["instagram", "tiktok"]);
  assert.equal(brand?.language, "es");
  assert.equal(brand?.active, true);
  const [withBrands] = await listFamiliesWithBrands();
  assert.deepEqual(
    withBrands.brands.map((b) => b.id),
    ["test-brand"],
  );

  const account = await as(owner, () =>
    saveAccountAction(
      null,
      form({
        brandId: "test-brand",
        platform: "instagram",
        handle: "@test.brand_py",
        language: "",
        status: "active",
        isProfessional: "on",
        notes: "Main feed",
      }),
    ),
  );
  assert.ok(account.ok);
  const [row] = await listAccounts({ brandId: "test-brand" });
  assert.equal(row.id, account.id);
  assert.equal(row.handle, "test.brand_py");
  assert.equal(row.language, null);
  assert.equal(row.effectiveLanguage, "es");
  assert.equal(row.status, "active");
  assert.equal(row.isProfessional, true);
  assert.equal(row.familyId, "test-family");

  const [logo] = await insertReturning(db, schema.assets, {
    brandId: "test-brand",
    kind: "image",
    mime: "image/png",
    bytes: 10,
    sha256: "b".repeat(64),
    source: "upload",
  });
  const kit = await as(owner, () =>
    saveKitAction(
      null,
      form({
        brandId: "test-brand",
        colorName: ["Primary", "", ""],
        colorHex: ["#0A7C66", "fc0", ""],
        fontRole: ["heading", ""],
        fontFamily: ["Fraunces", ""],
        logoAssetId: String(logo.id),
        elementIds: "el-1, el-2\nel-1",
        characterIds: "char-9",
        styleNotes: "Soft daylight",
        ctas: "Book a call\n\nDM us, today",
        hashtags: "#paraguay #residency, ##expat",
        dos: "Cite sources",
        donts: "No legal advice",
      }),
    ),
  );
  assert.deepEqual(kit, { ok: true });
  const saved = await getBrandKit("test-brand");
  assert.deepEqual(saved?.colors, [
    { name: "Primary", hex: "#0a7c66" },
    { name: "#ffcc00", hex: "#ffcc00" },
  ]);
  assert.deepEqual(saved?.fonts, [{ role: "heading", family: "Fraunces" }]);
  assert.equal(saved?.logoAssetId, logo.id);
  assert.deepEqual(saved?.higgsfield, {
    elementIds: ["el-1", "el-2"],
    characterIds: ["char-9"],
    styleNotes: "Soft daylight",
  });
  assert.deepEqual(saved?.ctas, ["Book a call", "DM us, today"]);
  assert.deepEqual(saved?.hashtags, ["paraguay", "residency", "expat"]);
  assert.equal(saved?.dos, "Cite sources");
  assert.equal(saved?.donts, "No legal advice");

  // Saving again updates the one kit rather than adding a second.
  assert.deepEqual(
    await as(owner, () => saveKitAction(null, form({ brandId: "test-brand", colorHex: "#000" }))),
    { ok: true },
  );
  const again = await getBrandKit("test-brand");
  assert.deepEqual(again?.colors, [{ name: "#000000", hex: "#000000" }]);
  assert.equal(again?.logoAssetId, null);
  assert.equal((await db.select().from(schema.brandKits)).length, 1);
});

test("a brand's id is permanent: edit keeps it, create refuses a taken or bad one", async () => {
  await seedBrand();
  const edit = await as(owner, () =>
    saveBrandAction(
      null,
      form({ ...BRAND, mode: "edit", name: "Renamed", familyId: "", platforms: [], active: "" }),
    ),
  );
  assert.deepEqual(edit, { ok: true, id: "test-brand" });
  const brand = await getBrand("test-brand");
  assert.equal(brand?.name, "Renamed");
  assert.equal(brand?.familyId, null);
  assert.equal(brand?.active, false);
  assert.deepEqual(brand?.platforms, []);

  const refusals = [
    { ...BRAND }, // taken
    { ...BRAND, id: "Bad Slug" },
    { ...BRAND, id: "new-one", familyId: "no-such-family" },
    { ...BRAND, id: "new-one", name: " " },
    { ...BRAND, id: "new-one", language: "english!" },
    { ...BRAND, id: "ghost", mode: "edit" }, // editing a brand that does not exist
  ];
  for (const input of refusals) {
    const res = await as(owner, () => saveBrandAction(null, form(input)));
    assert.equal(res.ok, false, JSON.stringify(input));
  }
  assert.deepEqual(
    (await listAllBrands()).map((b) => b.id),
    ["test-brand"],
  );
  assert.equal(
    (await as(owner, () => saveFamilyAction(null, form(FAMILY)))).ok,
    false,
    "a taken family id",
  );
});

test("accounts: unique platform + handle, status changes, edits", async () => {
  await seedBrand();
  const first = await as(owner, () =>
    saveAccountAction(null, form({ brandId: "test-brand", platform: "instagram", handle: "same" })),
  );
  assert.ok(first.ok);
  const clash = await as(owner, () =>
    saveAccountAction(
      null,
      form({ brandId: "test-brand", platform: "instagram", handle: "@same" }),
    ),
  );
  assert.equal(clash.ok, false);
  assert.match(clash.ok ? "" : clash.error, /already belongs to "test-brand"/);
  // The same handle on another platform is a different account.
  assert.ok(
    (
      await as(owner, () =>
        saveAccountAction(
          null,
          form({ brandId: "test-brand", platform: "tiktok", handle: "same" }),
        ),
      )
    ).ok,
  );
  for (const bad of [
    { brandId: "nope", platform: "instagram", handle: "x" },
    { brandId: "test-brand", platform: "myspace", handle: "x" },
    { brandId: "test-brand", platform: "instagram", handle: "has space" },
    { brandId: "test-brand", platform: "instagram", handle: "y", status: "deleted" },
  ]) {
    assert.equal(
      (await as(owner, () => saveAccountAction(null, form(bad)))).ok,
      false,
      JSON.stringify(bad),
    );
  }

  assert.deepEqual(await as(owner, () => setAccountStatusAction(first.id, "paused")), {
    ok: true,
  });
  assert.equal(
    (await as(owner, () => setAccountStatusAction(first.id, "gone" as "paused"))).ok,
    false,
  );
  assert.equal((await as(owner, () => setAccountStatusAction(9999, "active"))).ok, false);

  const edit = await as(owner, () =>
    saveAccountAction(
      null,
      form({
        accountId: String(first.id),
        brandId: "test-brand",
        platform: "instagram",
        handle: "same",
        language: "pt-BR",
        status: "active",
      }),
    ),
  );
  assert.deepEqual(edit, { ok: true, id: first.id });
  const accounts = await listAccounts({ brandId: "test-brand", platform: "instagram" });
  assert.equal(accounts.length, 1);
  assert.equal(accounts[0].language, "pt-BR");
  assert.equal(accounts[0].status, "active");
});

test("kits refuse a bad hex and a logo that is not this brand's image", async () => {
  await seedBrand();
  await db.insert(schema.brands).values({
    id: "other",
    name: "Other",
    domain: "",
    niche: "x",
    market: "global",
    platforms: [],
  });
  const [video, foreign] = await insertReturning(db, schema.assets, [
    { kind: "video", mime: "video/mp4", bytes: 1, sha256: "c".repeat(64), source: "upload" },
    {
      brandId: "other",
      kind: "image",
      mime: "image/png",
      bytes: 1,
      sha256: "d".repeat(64),
      source: "upload",
    },
  ]);
  for (const bad of [
    { brandId: "test-brand", colorHex: "#12345" },
    { brandId: "test-brand", colorHex: "blue" },
    { brandId: "test-brand", logoAssetId: String(video.id) },
    { brandId: "test-brand", logoAssetId: String(foreign.id) },
    { brandId: "test-brand", logoAssetId: "999" },
    { brandId: "no-brand" },
  ]) {
    assert.equal(
      (await as(owner, () => saveKitAction(null, form(bad)))).ok,
      false,
      JSON.stringify(bad),
    );
  }
  assert.equal(await getBrandKit("test-brand"), null);
});

test("every write is owner-only; signed-out is redirected", async () => {
  const refused = [
    await as(employee, () => saveFamilyAction(null, form(FAMILY))),
    await as(employee, () => saveBrandAction(null, form({ ...BRAND, familyId: "" }))),
    await as(employee, () =>
      saveAccountAction(null, form({ brandId: "x", platform: "instagram", handle: "x" })),
    ),
    await as(employee, () => setAccountStatusAction(1, "active")),
    await as(employee, () => saveKitAction(null, form({ brandId: "x" }))),
  ];
  for (const res of refused) {
    assert.equal(res.ok, false);
    assert.match(res.ok ? "" : res.error, /Only the owner/);
  }
  assert.equal((await listAllBrands()).length, 0);
  assert.equal(await getFamily("test-family"), null);
  await assert.rejects(
    as("", () => saveFamilyAction(null, form(FAMILY))),
    /redirect/,
  );
});
