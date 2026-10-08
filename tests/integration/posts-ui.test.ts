import { insertReturning } from "@/db/mutations";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, beforeEach, test } from "node:test";

import { asc, eq } from "drizzle-orm";

import { db, schema } from "@/db";
import { listCalendarPosts, listPostAssets, listPosts } from "@/lib/bridge";
import { exportPack } from "@/lib/posts/engine";
import {
  adaptPostAction,
  attachAssetAction,
  createPostAction,
  detachAssetAction,
  markPostedAction,
  reorderAssetsAction,
  savePostAction,
  schedulePostAction,
  setAssetRoleAction,
  setPostStatusAction,
} from "@/lib/posts.actions";
import type { PostDraft } from "@/lib/posts/contract";
import { monthToDateUsd } from "@/lib/spend";

import { callRoute, signIn } from "./route";
import { resetTables, teardown } from "./setup";

/**
 * S15's server actions (PLAN.md §6.S15): drafting a post from the UI under the
 * Gemini fake, attaching and reordering library files, scheduling (and the
 * calendar's drag-to-reschedule), and the post pack's "Mark posted". Same
 * `as()` harness as lessons-ui.test.ts: the actions read the session through
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
    new Request("http://localhost/posts", { method: "POST", headers: { cookie } }),
  );
  if (error) throw error;
  return result as T;
}

const FAMILY = "residency-family";
const brand = (id: string, language: string) => ({
  id,
  name: `Brand ${id}`,
  domain: `${id}.example`,
  niche: "residency",
  market: "global",
  language,
  platforms: ["instagram"],
  familyId: FAMILY,
});

let owner = "";
let employee = "";
let accounts: Record<string, number> = {};

async function asset(n: number, brandId: string | null = "alpha") {
  const [row] = await insertReturning(db, schema.assets, {
    brandId,
    kind: "image",
    mime: "image/webp",
    bytes: 1000 + n,
    sha256: String(n).padStart(64, "0"),
    source: "higgsfield",
    localPath: `alpha/_brand/2026-09/file-${n}.webp`,
  });
  return row.id;
}

beforeEach(async () => {
  process.env.MONTHLY_SPEND_CAP_USD = "5";
  await resetTables();
  await db.insert(schema.brandFamilies).values({ id: FAMILY, name: "Residency family" });
  await db.insert(schema.brands).values([brand("alpha", "en"), brand("beta", "es")]);
  const rows = await insertReturning(db, schema.socialAccounts, [
    { brandId: "alpha", platform: "instagram", handle: "alpha_en", status: "active" },
    { brandId: "beta", platform: "instagram", handle: "beta_es", status: "active" },
  ]);
  const [link] = await insertReturning(db, schema.integrations, {
    provider: "meta",
    label: "Synthetic publication target",
  });
  for (const row of rows)
    await db
      .update(schema.socialAccounts)
      .set({ externalId: `fixture-${row.id}`, integrationId: link.id, isProfessional: true })
      .where(eq(schema.socialAccounts.id, row.id));
  accounts = Object.fromEntries(rows.map((r) => [r.handle, r.id]));
  owner = (await signIn("owner")).cookie;
  employee = (await signIn("employee")).cookie;
});

after(async () => {
  delete process.env.MONTHLY_SPEND_CAP_USD;
  await teardown();
});

async function draft(topic = "The 45-day timeline"): Promise<number> {
  const result = await as(owner, () =>
    createPostAction({ accountId: accounts.alpha_en, topic, format: "carousel" }),
  );
  assert.ok(result.ok, JSON.stringify(result));
  return result.id;
}

async function postRow(id: number) {
  const [row] = await db.select().from(schema.posts).where(eq(schema.posts.id, id));
  return row;
}

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

test("create: the owner drafts a post from a topic; it is listed, billed and editable", async () => {
  const id = await draft();
  const post = await postRow(id);
  assert.equal(post.status, "drafting");
  assert.equal(post.format, "carousel");
  assert.equal(post.accountId, accounts.alpha_en);
  assert.equal(post.title, "The 45-day timeline");
  assert.ok((await monthToDateUsd()) > 0, "the draft was billed");

  const list = await listPosts({ accountId: accounts.alpha_en });
  assert.deepEqual(
    list.posts.map((p) => p.id),
    [id],
  );

  // The editor's save: a whole draft, validated, refreshing the caption.
  const body = post.body as PostDraft;
  const saved = await as(employee, () =>
    savePostAction(id, {
      title: "Renamed",
      notes: "check the fee",
      body: { ...body, caption: "EDITED caption", hashtags: ["one", "two"] },
    }),
  );
  assert.deepEqual(saved, { ok: true });
  const after = await postRow(id);
  assert.equal(after.title, "Renamed");
  assert.equal(after.notes, "check the fee");
  assert.equal(after.caption, "EDITED caption\n\n#one #two");

  const invalid = await as(employee, () => savePostAction(id, { body: { ...body, hook: "" } }));
  assert.equal(invalid.ok, false);
  assert.ok(!invalid.ok && invalid.errors?.some((e) => /body\.hook/.test(e)), "says which field");
});

test("create: drafting and adapting are owner-only and refuse bad input before spending", async () => {
  const denied = await as(employee, () =>
    createPostAction({ accountId: accounts.alpha_en, topic: "x" }),
  );
  assert.equal(denied.ok, false);
  assert.equal(await monthToDateUsd(), 0);

  for (const input of [
    { accountId: 0, topic: "x" },
    { accountId: accounts.alpha_en },
    { accountId: accounts.alpha_en, topic: "x", format: "podcast" },
    { accountId: 999, topic: "x" },
  ]) {
    const result = await as(owner, () => createPostAction(input));
    assert.equal(result.ok, false, JSON.stringify(input));
  }
  assert.equal(await monthToDateUsd(), 0, "nothing was spent on a refusal");

  const id = await draft();
  assert.equal((await as(employee, () => adaptPostAction(id))).ok, false);
  const adapted = await as(owner, () => adaptPostAction(id));
  assert.ok(adapted.ok);
  assert.equal(adapted.created.length, 1, "one sibling: beta_es");
  assert.equal(adapted.created[0].accountId, accounts.beta_es);
});

// ---------------------------------------------------------------------------
// attach / reorder
// ---------------------------------------------------------------------------

test("attach/reorder: files go on in order, move, change role and detach with positions kept 1..n", async () => {
  const id = await draft();
  const [a, b, c] = [await asset(1), await asset(2), await asset(3)];

  for (const assetId of [a, b, c]) {
    const result = await as(employee, () => attachAssetAction(id, assetId));
    assert.ok(result.ok);
  }
  const ids = async () => (await listPostAssets(id)).map((x) => [x.position, x.assetId]);
  assert.deepEqual(await ids(), [
    [1, a],
    [2, b],
    [3, c],
  ]);

  const dupe = await as(employee, () => attachAssetAction(id, b));
  assert.equal(dupe.ok, false, "the same file twice is refused");
  const other = await asset(4, "beta");
  assert.equal((await as(employee, () => attachAssetAction(id, other))).ok, false);
  const unsorted = await asset(5, null);
  assert.ok((await as(employee, () => attachAssetAction(id, unsorted, "cover"))).ok);

  assert.deepEqual(await as(employee, () => reorderAssetsAction(id, [unsorted, c, a, b])), {
    ok: true,
  });
  assert.deepEqual(await ids(), [
    [1, unsorted],
    [2, c],
    [3, a],
    [4, b],
  ]);
  const roles = (await listPostAssets(id)).map((x) => x.role);
  assert.deepEqual(roles, ["cover", "slide", "slide", "slide"], "roles travel with their file");

  const stale = await as(employee, () => reorderAssetsAction(id, [c, a, b]));
  assert.equal(stale.ok, false, "a reorder that misses a file is refused");

  assert.ok((await as(employee, () => setAssetRoleAction(id, c, "thumbnail"))).ok);
  assert.ok((await as(employee, () => detachAssetAction(id, a))).ok);
  assert.deepEqual(await ids(), [
    [1, unsorted],
    [2, c],
    [3, b],
  ]);
  assert.equal((await listPostAssets(id))[1].role, "thumbnail");
  assert.equal((await as(employee, () => detachAssetAction(id, a))).ok, false);

  // The pack lists the files in the same order.
  const pack = (await exportPack(id)).json;
  assert.deepEqual(
    pack.files.map((f) => f.assetId),
    [unsorted, c, b],
  );
  assert.equal(pack.files[0].url, `/api/media/asset/${unsorted}`);
});

// ---------------------------------------------------------------------------
// schedule
// ---------------------------------------------------------------------------

test("schedule: a ready post gets a date and is scheduled in one step; drag moves the date only", async () => {
  const id = await draft();
  const when = "2026-10-05T18:30:00.000Z";

  const early = await as(employee, () => schedulePostAction(id, when, { schedule: true }));
  assert.equal(early.ok, false, "a drafting post cannot be scheduled");
  assert.equal((await postRow(id)).scheduledFor, null, "and nothing was written");

  assert.ok((await as(employee, () => setPostStatusAction(id, "ready"))).ok);
  assert.equal(
    (await as(employee, () => schedulePostAction(id, when, { schedule: true }))).ok,
    false,
    "employees cannot authorize a send",
  );
  const scheduled = await as(owner, () => schedulePostAction(id, when, { schedule: true }));
  assert.ok(scheduled.ok);
  assert.equal(scheduled.status, "scheduled");
  assert.equal(scheduled.scheduledFor, when);

  const inRange = await listCalendarPosts({
    from: new Date("2026-10-01T00:00:00Z"),
    to: new Date("2026-11-01T00:00:00Z"),
    familyId: FAMILY,
  });
  assert.deepEqual(
    inRange.map((p) => p.id),
    [id],
  );

  // The calendar's drop: a new date, the status stays.
  const moved = "2026-10-07T18:30:00.000Z";
  assert.equal((await as(employee, () => schedulePostAction(id, moved))).ok, false);
  const dragged = await as(owner, () => schedulePostAction(id, moved));
  assert.ok(dragged.ok);
  assert.equal(dragged.status, "scheduled");
  assert.equal((await postRow(id)).scheduledFor?.toISOString(), moved);

  assert.equal((await as(employee, () => schedulePostAction(id, null))).ok, false);
  assert.equal((await as(employee, () => schedulePostAction(id, "not a date"))).ok, false);
  assert.equal(
    (await as(employee, () => setPostStatusAction(id, "idea"))).ok,
    false,
    "an illegal move is refused by O11's table",
  );
});

// ---------------------------------------------------------------------------
// mark posted
// ---------------------------------------------------------------------------

test("mark posted: the pack stamps published_at and the permalink; a posted post stays put", async () => {
  const id = await draft();
  assert.equal(
    (await as(employee, () => markPostedAction(id, null))).ok,
    false,
    "a drafting post is not posted",
  );
  assert.ok((await as(employee, () => setPostStatusAction(id, "ready"))).ok);

  const badLink = await as(employee, () => markPostedAction(id, "javascript:alert(1)"));
  assert.equal(badLink.ok, false);
  assert.equal((await postRow(id)).status, "ready");

  const link = "https://www.instagram.com/p/ABC123/";
  const posted = await as(employee, () => markPostedAction(id, link));
  assert.deepEqual(posted, { ok: true, permalink: link });
  const row = await postRow(id);
  assert.equal(row.status, "published");
  assert.ok(row.publishedAt, "published_at is stamped");
  assert.equal(row.permalink, link);

  // Saving the permalink again later only updates it.
  const later = "https://www.instagram.com/p/XYZ789/";
  assert.ok((await as(employee, () => markPostedAction(id, later))).ok);
  const again = await postRow(id);
  assert.equal(again.permalink, later);
  assert.equal(again.publishedAt?.toISOString(), row.publishedAt?.toISOString());

  assert.equal(
    (await as(employee, () => schedulePostAction(id, "2026-12-01T10:00:00Z"))).ok,
    false,
    "a posted post keeps its date",
  );
  const published = await db
    .select({ id: schema.posts.id })
    .from(schema.posts)
    .where(eq(schema.posts.status, "published"))
    .orderBy(asc(schema.posts.id));
  assert.deepEqual(
    published.map((p) => p.id),
    [id],
  );
});
