import { insertReturning } from "@/db/mutations";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, test } from "node:test";
import sharp from "sharp";

import { db, schema } from "@/db";
import { mediaQueryFrom, type MediaSearchParams } from "@/app/media/query";
import { getAsset, listAssets } from "@/lib/bridge/assets";
import { sha256File } from "@/lib/media/register";
import { bulkMediaAction, scanNowAction } from "@/lib/media.actions";

import { callRoute, signIn } from "./route";
import { resetTables, teardown } from "./setup";

/**
 * S14 exit (PLAN.md §6.S14): the library's URL filters reach the right rows,
 * and the bulk actions tag, sort, approve/reject/archive — and move a file out
 * of the unsorted inbox into the §1.41 layout when it gets a brand. Same
 * `as()` harness as lessons-ui.test.ts: actions read the session through
 * `cookies()`, and `revalidatePath` needs an `incrementalCache`.
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
    new Request("http://localhost/media", { method: "POST", headers: { cookie } }),
  );
  if (error) throw error;
  return result as T;
}

let base = "";
let root = "";
let user = "";
let png: Buffer;
let guideAccount = 0;
let otherAccount = 0;

function write(rel: string, data: Buffer | string): string {
  const file = path.join(root, ...rel.split("/"));
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, data);
  return file;
}

let shaCounter = 0;
async function asset(values: Partial<typeof schema.assets.$inferInsert> = {}) {
  shaCounter++;
  const [row] = await insertReturning(db, schema.assets, {
    kind: "image",
    mime: "image/png",
    bytes: 100,
    sha256: shaCounter.toString(16).padStart(64, "0"),
    source: "higgsfield",
    ...values,
  });
  return row;
}

async function ids(params: MediaSearchParams, inbox = false): Promise<number[]> {
  const page = await listAssets(mediaQueryFrom(params, inbox));
  return page.assets.map((a) => a.id).sort((a, b) => a - b);
}

before(async () => {
  png = await sharp({ create: { width: 40, height: 50, channels: 3, background: "#3a6" } })
    .png()
    .toBuffer();
});

beforeEach(async () => {
  base = mkdtempSync(path.join(tmpdir(), "s14-"));
  root = path.join(base, "drive");
  mkdirSync(root);
  process.env.MEDIA_ROOT = root;
  await resetTables();
  user = (await signIn("owner")).cookie;
  await db.insert(schema.brands).values([
    {
      id: "guide",
      name: "Guide",
      domain: "guide.example",
      niche: "residency",
      market: "paraguay",
      platforms: ["instagram"],
    },
    {
      id: "flytta",
      name: "Flytta",
      domain: "flytta.example",
      niche: "residency",
      market: "paraguay",
      language: "sv",
      platforms: ["instagram"],
    },
  ]);
  const accounts = await insertReturning(db, schema.socialAccounts, [
    { brandId: "guide", platform: "instagram", handle: "@Guide.EN", status: "active" },
    { brandId: "flytta", platform: "instagram", handle: "flytta_se", status: "active" },
  ]);
  guideAccount = accounts[0].id;
  otherAccount = accounts[1].id;
});

after(async () => {
  delete process.env.MEDIA_ROOT;
  if (base) rmSync(base, { recursive: true, force: true });
  await teardown();
});

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

test("URL filters: brand, unsorted, account, status, source, kind, tag and inclusive dates", async () => {
  const a = await asset({
    brandId: "guide",
    accountId: guideAccount,
    status: "approved",
    tags: ["cedula"],
    createdAt: new Date("2026-09-01T10:00:00Z"),
  });
  const b = await asset({
    brandId: "flytta",
    kind: "video",
    mime: "video/mp4",
    source: "upload",
    createdAt: new Date("2026-09-10T23:30:00Z"),
  });
  const c = await asset({
    status: "rejected",
    tags: ["cedula", "inbox"],
    createdAt: new Date("2026-09-20T10:00:00Z"),
  });

  assert.deepEqual(await ids({}), [a.id, b.id, c.id]);
  assert.deepEqual(await ids({ brand: "guide" }), [a.id]);
  assert.deepEqual(await ids({ brand: "none" }), [c.id]);
  assert.deepEqual(await ids({ account: String(guideAccount) }), [a.id]);
  assert.deepEqual(await ids({ status: "rejected" }), [c.id]);
  assert.deepEqual(await ids({ source: "upload" }), [b.id]);
  assert.deepEqual(await ids({ kind: "video" }), [b.id]);
  assert.deepEqual(await ids({ tag: "CEDULA" }), [a.id, c.id]);
  assert.deepEqual(await ids({ tag: "cedula", brand: "none" }), [c.id]);
  // `to` is inclusive of the whole day; `from` starts at midnight UTC.
  assert.deepEqual(await ids({ from: "2026-09-10", to: "2026-09-10" }), [b.id]);
  assert.deepEqual(await ids({ to: "2026-09-10" }), [a.id, b.id]);
  // Junk is dropped, not an error: a stale link shows everything.
  assert.deepEqual(
    await ids({ status: "bogus", kind: "x", source: "y", account: "-1", from: "yesterday" }),
    [a.id, b.id, c.id],
  );
  // The inbox is always the unsorted scope, whatever brand the URL names.
  assert.deepEqual(await ids({ brand: "guide" }, true), [c.id]);
});

// ---------------------------------------------------------------------------
// Bulk actions
// ---------------------------------------------------------------------------

test("bulk tag and untag: lower-cased, deduped, other tags kept", async () => {
  const a = await asset({ tags: ["keep"] });
  const b = await asset();

  const tagged = await as(user, () =>
    bulkMediaAction({ ids: [a.id, b.id, a.id], op: "tag", tags: ["#Cedula, Keep", "  "] }),
  );
  assert.deepEqual(tagged, { ok: true, updated: 2, moved: 0, warnings: [] });
  assert.deepEqual((await getAsset(a.id))!.tags, ["keep", "cedula"]);
  assert.deepEqual((await getAsset(b.id))!.tags, ["cedula", "keep"]);

  const untagged = await as(user, () =>
    bulkMediaAction({ ids: [a.id, b.id], op: "untag", tags: ["keep"] }),
  );
  assert.equal(untagged.ok, true);
  assert.deepEqual((await getAsset(a.id))!.tags, ["cedula"]);
  assert.deepEqual((await getAsset(b.id))!.tags, ["cedula"]);

  const empty = await as(user, () => bulkMediaAction({ ids: [a.id], op: "tag", tags: [" , "] }));
  assert.equal(empty.ok, false);
});

test("bulk approve, reject, archive and restore set the status of every selected file", async () => {
  const a = await asset();
  const b = await asset();
  const c = await asset();

  for (const [op, status] of [
    ["approve", "approved"],
    ["reject", "rejected"],
    ["archive", "archived"],
    ["restore", "new"],
  ] as const) {
    const result = await as(user, () => bulkMediaAction({ ids: [a.id, b.id], op }));
    assert.equal(result.ok, true, op);
    assert.equal((await getAsset(a.id))!.status, status);
    assert.equal((await getAsset(b.id))!.status, status);
    assert.equal((await getAsset(c.id))!.status, "new", "unselected files are untouched");
  }
  assert.deepEqual(await ids({ status: "new" }), [a.id, b.id, c.id]);
});

test("bulk input is checked: ids, limit, unknown op, unknown brand, account of another brand", async () => {
  const a = await asset();
  const bad = async (input: Parameters<typeof bulkMediaAction>[0]) => {
    const result = await as(user, () => bulkMediaAction(input));
    assert.equal(result.ok, false, JSON.stringify(input));
  };
  await bad({ ids: [], op: "approve" });
  await bad({ ids: [1.5], op: "approve" });
  await bad({ ids: Array.from({ length: 201 }, (_, i) => i + 1), op: "approve" });
  await bad({ ids: [a.id], op: "delete" as never });
  await bad({ ids: [a.id], op: "assign", brandId: "nope" });
  await bad({ ids: [a.id], op: "assign", brandId: "guide", accountId: otherAccount });
  await bad({ ids: [a.id], op: "assign", accountId: 99999 });
  await bad({ ids: [99999], op: "approve" });
  assert.equal((await getAsset(a.id))!.brandId, null);
});

test("assigning a brand keeps scanned originals immutable and updates the asset metadata", async () => {
  write("_inbox/higgsfield/2026-09-27/Sunset Plaza.png", png);
  write("_inbox/higgsfield/2026-09-27/other.png", Buffer.concat([png, Buffer.from("x")]));
  const scan = await as(user, () => scanNowAction());
  assert.equal(scan.ok && scan.created, 2);
  const [first, second] = await db.select().from(schema.assets).orderBy(schema.assets.id);
  assert.deepEqual(await ids({}, true), [first.id, second.id]);
  const result = await as(user, () =>
    bulkMediaAction({ ids: [first.id, second.id], op: "assign", accountId: guideAccount }),
  );
  assert.deepEqual(result, { ok: true, updated: 2, moved: 0, warnings: [] });

  const movedFirst = (await getAsset(first.id))!;
  assert.equal(movedFirst.brandId, "guide", "the brand comes from the account");
  assert.equal(movedFirst.accountId, guideAccount);
  assert.match(movedFirst.localPath!, /^_originals\/[a-f0-9]{2}\/[a-f0-9]{64}\.png$/);
  assert.ok(existsSync(path.join(root, movedFirst.localPath!)));
  assert.equal(await sha256File(path.join(root, movedFirst.localPath!)), movedFirst.sha256);
  assert.ok(existsSync(path.join(root, "_inbox/higgsfield/2026-09-27/Sunset Plaza.png")));

  const movedSecond = (await getAsset(second.id))!;
  assert.match(movedSecond.localPath!, /^_originals\/[a-f0-9]{2}\/[a-f0-9]{64}\.png$/);
  assert.ok(existsSync(path.join(root, movedSecond.localPath!)));
  assert.equal(await sha256File(path.join(root, movedSecond.localPath!)), movedSecond.sha256);
  assert.ok(existsSync(path.join(root, "_inbox/higgsfield/2026-09-27/other.png")));

  // The source files and their immutable identities remain stable across scans.
  assert.deepEqual(await ids({}, true), []);
  assert.deepEqual(await ids({ brand: "guide" }), [first.id, second.id]);
  const rescan = await as(user, () => scanNowAction());
  assert.equal(rescan.ok && rescan.created, 0, "immutable originals remain the same rows");
  assert.equal((await db.select().from(schema.assets)).length, 2);

  // Unassigning changes only metadata; immutable bytes stay in place.
  const unassign = await as(user, () =>
    bulkMediaAction({ ids: [first.id], op: "assign", brandId: null }),
  );
  assert.equal(unassign.ok && unassign.moved, 0);
  const back = (await getAsset(first.id))!;
  assert.equal(back.brandId, null);
  assert.equal(back.accountId, null);
  assert.equal(back.localPath, movedFirst.localPath);
});

test("assigning a manifest-backed original keeps the manifest path and prompt on rescan", async () => {
  write("_inbox/higgsfield/2026-09-27/hero.png", png);
  write(
    "_inbox/higgsfield/2026-09-27/manifest.json",
    JSON.stringify({
      source: "higgsfield",
      files: [
        { file: "hero.png", prompt: "Asunción skyline at dusk", model: "m1", jobId: "job-1" },
      ],
    }),
  );
  const scan = await as(user, () => scanNowAction());
  assert.equal(scan.ok && scan.created, 1);
  const [row] = await db.select().from(schema.assets);
  assert.equal(row.prompt, "Asunción skyline at dusk");

  const result = await as(user, () =>
    bulkMediaAction({ ids: [row.id], op: "assign", brandId: "flytta" }),
  );
  assert.equal(result.ok && result.moved, 0);
  const moved = (await getAsset(row.id))!;
  const manifest = JSON.parse(
    readFileSync(path.join(root, "_inbox/higgsfield/2026-09-27/manifest.json"), "utf8"),
  );
  assert.equal(manifest.files[0].file, "hero.png");
  assert.match(moved.localPath!, /^_originals\/[a-f0-9]{2}\/[a-f0-9]{64}\.png$/);
  assert.equal(await sha256File(path.join(root, moved.localPath!)), moved.sha256);
  assert.equal(manifest.files[0].prompt, "Asunción skyline at dusk");

  const rescan = await as(user, () => scanNowAction());
  assert.deepEqual(rescan.ok && [rescan.created, rescan.errors], [0, 0]);
  const after = (await getAsset(row.id))!;
  assert.equal(after.localPath, moved.localPath);
  assert.equal(after.brandId, "flytta");
});

test("brand-level assign uses _brand; files outside the inbox never move", async () => {
  const inInbox = await asset({ localPath: "_inbox/higgsfield/2026-09-27/a.png" });
  write("_inbox/higgsfield/2026-09-27/a.png", png);
  const sorted = await asset({ brandId: "flytta", localPath: "flytta/_brand/2026-09/b.png" });
  write("flytta/_brand/2026-09/b.png", png);

  const result = await as(user, () =>
    bulkMediaAction({ ids: [inInbox.id, sorted.id], op: "assign", brandId: "guide" }),
  );
  assert.equal(result.ok && result.moved, 1);
  const month = inInbox.createdAt.toISOString().slice(0, 7);
  assert.equal((await getAsset(inInbox.id))!.localPath, `guide/_brand/${month}/a.png`);
  const kept = (await getAsset(sorted.id))!;
  assert.equal(kept.brandId, "guide");
  assert.equal(kept.localPath, "flytta/_brand/2026-09/b.png");
});

test("media drive not connected: assign keeps the row change and warns; scan says so", async () => {
  const a = await asset({ localPath: "_inbox/higgsfield/2026-09-27/a.png" });
  process.env.MEDIA_ROOT = path.join(base, "unplugged");

  const result = await as(user, () =>
    bulkMediaAction({ ids: [a.id], op: "assign", brandId: "guide" }),
  );
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.moved, 0);
  assert.match(result.ok ? result.warnings[0] : "", /not connected/);
  const row = (await getAsset(a.id))!;
  assert.equal(row.brandId, "guide");
  assert.equal(row.localPath, "_inbox/higgsfield/2026-09-27/a.png");

  const scan = await as(user, () => scanNowAction());
  assert.equal(scan.ok, false);
  assert.match(scan.ok ? "" : scan.error, /not connected/);
});
