import { insertReturning } from "@/db/mutations";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { assets, brands, posts, postAssets, socialAccounts, users, type Post } from "@/db/schema";
import { assetOriginal } from "@/lib/media/originals";
import { generateEncryptionKey } from "@/lib/crypto";
import { saveMetaConnection } from "@/lib/meta/integration";
import { stopPublishingAction } from "@/lib/publish/actions";
import { publishDue, publishPost } from "@/lib/publish";
import { updatePost, PostEngineError } from "@/lib/posts/engine";
import {
  schedulePostAction,
  setPostStatusAction,
  savePostAction,
  attachAssetAction,
} from "@/lib/posts.actions";
import { saveAccountAction } from "@/lib/accounts.actions";
import { PATCH } from "@/app/api/posts/[id]/route";
import { callRoute, jsonPost, signIn } from "./route";
import { resetTables, teardown } from "./setup";

const NOW = new Date("2026-10-08T12:00:00Z"),
  PAST = new Date(NOW.getTime() - 60_000);
const FAST = { poll: { tries: 1, delayMs: 0 } };
let ownerId: number, accountId: number, ownerCookie: string;
const require = createRequire(import.meta.url);
async function as<T>(cookie: string, fn: () => Promise<T>): Promise<T> {
  let value: T | undefined;
  await callRoute(
    async () => {
      const {
        workAsyncStorage,
      } = require("next/dist/server/app-render/work-async-storage.external");
      workAsyncStorage.getStore().incrementalCache = {};
      value = await fn();
      return new Response(null);
    },
    new Request("http://localhost/posts", { headers: { cookie } }),
  );
  return value!;
}
beforeEach(async () => {
  await resetTables();
  process.env.ENCRYPTION_KEY = generateEncryptionKey();
  const owner = await signIn("owner");
  ownerId = owner.userId;
  ownerCookie = owner.cookie;
  await db.insert(brands).values([
    {
      id: "a",
      name: "Synthetic A",
      domain: "example.invalid",
      niche: "fixture",
      market: "global",
      language: "en",
      platforms: ["facebook"],
    },
    {
      id: "b",
      name: "Synthetic B",
      domain: "example.invalid",
      niche: "fixture",
      market: "global",
      language: "en",
      platforms: ["facebook"],
    },
  ]);
  const connection = await saveMetaConnection({
    token: "SYNTHETIC",
    expiresAt: new Date("2027-01-01"),
    userId: "synthetic",
    userName: "Fixture",
    scopes: ["pages_manage_posts"],
  });
  const [account] = await insertReturning(db, socialAccounts, {
    brandId: "a",
    platform: "facebook",
    handle: "synthetic",
    status: "active",
    externalId: "target-a",
    integrationId: connection.id,
  });
  accountId = account.id;
});
after(teardown);
async function post(overrides: Partial<typeof posts.$inferInsert> = {}) {
  const [p] = await insertReturning(db, posts, {
    accountId,
    brandId: "a",
    format: "text",
    status: "ready",
    body: { version: 1 },
    caption: "Synthetic caption",
    ...overrides,
  });
  return p;
}
async function image() {
  const data = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6po0AAAAASUVORK5CYII=",
    "base64",
  );
  const rel = "publishing-safety-image.png";
  await mkdir(process.env.MEDIA_ROOT!, { recursive: true });
  await writeFile(path.join(process.env.MEDIA_ROOT!, rel), data);
  const [a] = await insertReturning(db, assets, {
    brandId: "a",
    kind: "image",
    mime: "image/png",
    bytes: data.length,
    sha256: createHash("sha256").update(data).digest("hex"),
    localPath: rel,
    source: "import",
    status: "approved",
    width: 1,
    height: 1,
    publicUrl: "https://example.invalid/image.png",
    publicExpiresAt: new Date("2027-01-01"),
  });
  assert.ok(await assetOriginal(a), JSON.stringify({ root: process.env.MEDIA_ROOT, asset: a }));
  return a;
}
async function approve(p: Post) {
  return updatePost(
    p.id,
    { status: "scheduled", scheduledFor: PAST },
    { expectedRevision: p.revision, authorizeSend: { ownerId } },
  );
}
async function load(id: number) {
  return (await db.select().from(posts).where(eq(posts.id, id)))[0];
}
function provider(
  input: {
    uncertain?: boolean;
    beforeResult?: () => Promise<void>;
    permalinkFailure?: boolean;
  } = {},
) {
  let creates = 0;
  const fetch = async (raw: string, init?: RequestInit) => {
    const url = new URL(raw),
      route = url.pathname.replace(/^\/v\d+\.\d+\//, ""),
      method = init?.method ?? "GET";
    let value: unknown;
    if (method === "GET" && route === "target-a") value = { access_token: "synthetic-page" };
    else if (method === "POST" && (route === "target-a/feed" || route === "target-a/photos")) {
      creates++;
      await input.beforeResult?.();
      if (input.uncertain) throw Error("Synthetic connection loss after provider acceptance");
      value = { id: `live-${creates}`, post_id: `live-${creates}` };
    } else if (method === "GET" && route.startsWith("live-")) {
      if (input.permalinkFailure) throw Error("Synthetic permalink read failure");
      value = { permalink_url: "https://example.invalid/" + route };
    } else throw Error("Unexpected synthetic provider route " + method + " " + route);
    return new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
  };
  return {
    fetch,
    get creates() {
      return creates;
    },
  };
}
test("BUG03 bookkeeping and permalink failures preserve confirmed publication; retries never create twice", async () => {
  const a = await image(),
    p = await post({ format: "image_post" });
  await db.insert(postAssets).values({ postId: p.id, assetId: a.id, position: 1, role: "slide" });
  await db.execute(
    sql.raw(
      "create function safety_fail_used() returns trigger language plpgsql as $$ begin if NEW.status='used' then raise exception 'synthetic bookkeeping fault'; end if; return NEW; end; $$",
    ),
  );
  await db.execute(
    sql.raw(
      "create trigger safety_fail_used before update on assets for each row execute function safety_fail_used()",
    ),
  );
  try {
    const api = provider({ permalinkFailure: true });
    const first = await publishPost(p.id, { now: NOW, ownerId, fetch: api.fetch, ...FAST });
    assert.equal(first.result, "published", JSON.stringify(first));
    assert.match(first.message!, /bookkeeping/);
    const saved = await load(p.id);
    assert.equal(saved.status, "published");
    assert.equal(saved.publishState, "confirmed");
    assert.equal(saved.externalMediaId, "live-1");
    assert.equal(
      (await publishPost(p.id, { now: NOW, ownerId, fetch: api.fetch, ...FAST })).result,
      "skipped",
    );
    await publishDue({ now: NOW, fetch: api.fetch, ...FAST });
    assert.equal(api.creates, 1);
  } finally {
    await db.execute(
      sql.raw("drop trigger safety_fail_used on assets; drop function safety_fail_used()"),
    );
  }
});
test("BUG03 failure while storing the accepted provider ID becomes reconciliation-only", async () => {
  const p = await post(),
    api = provider();
  await db.execute(
    sql.raw(
      "create function safety_fail_confirmation() returns trigger language plpgsql as $$ begin if NEW.external_media_id is not null then raise exception 'synthetic confirmation fault'; end if; return NEW; end; $$",
    ),
  );
  await db.execute(
    sql.raw(
      "create trigger safety_fail_confirmation before update on posts for each row execute function safety_fail_confirmation()",
    ),
  );
  try {
    assert.equal(
      (await publishPost(p.id, { now: NOW, ownerId, fetch: api.fetch, ...FAST })).result,
      "failed",
    );
    assert.equal((await load(p.id)).publishState, "ambiguous");
    assert.equal(
      (await publishPost(p.id, { now: NOW, ownerId, fetch: api.fetch, ...FAST })).result,
      "skipped",
    );
    assert.equal(api.creates, 1);
  } finally {
    await db.execute(
      sql.raw(
        "drop trigger safety_fail_confirmation on posts; drop function safety_fail_confirmation()",
      ),
    );
  }
});
test("BUG03 unknown provider acceptance is blocked for manual and due retry", async () => {
  const p = await approve(await post()),
    api = provider({ uncertain: true });
  assert.equal(
    (await publishPost(p.id, { trigger: "due", now: NOW, fetch: api.fetch, ...FAST })).result,
    "failed",
  );
  assert.equal((await load(p.id)).publishState, "ambiguous");
  assert.equal(
    (await publishPost(p.id, { now: NOW, ownerId, fetch: api.fetch, ...FAST })).result,
    "skipped",
  );
  await publishDue({ now: new Date(NOW.getTime() + 60 * 60_000), fetch: api.fetch, ...FAST });
  assert.equal(api.creates, 1);
});
test("BUG04 a future reschedule prevents a due claim and stale editorial revisions reject", async () => {
  const p = await approve(await post());
  await updatePost(
    p.id,
    { scheduledFor: new Date(NOW.getTime() + 24 * 60 * 60_000) },
    { expectedRevision: p.revision, authorizeSend: { ownerId } },
  );
  await assert.rejects(
    updatePost(p.id, { status: "ready" }, { expectedRevision: p.revision }),
    PostEngineError,
  );
  const api = provider();
  assert.equal(
    (await publishPost(p.id, { trigger: "due", now: NOW, fetch: api.fetch, ...FAST })).result,
    "skipped",
  );
  assert.equal(api.creates, 0);
});
test("BUG04 an editor cannot overwrite publishing or confirmed with a stale ready status", async () => {
  const p = await approve(await post());
  const api = provider({
    beforeResult: async () => {
      await assert.rejects(
        updatePost(p.id, { status: "ready" }, { expectedRevision: p.revision }),
        PostEngineError,
      );
    },
  });
  assert.equal(
    (await publishPost(p.id, { trigger: "due", now: NOW, fetch: api.fetch, ...FAST })).result,
    "published",
  );
  await assert.rejects(updatePost(p.id, { status: "ready" }), PostEngineError);
  assert.equal((await load(p.id)).status, "published");
  assert.equal(api.creates, 1);
});
test("BUG05 employee action and PATCH cannot authorize a scheduled send", async () => {
  const employee = await signIn("employee"),
    p = await post();
  const result = await as(employee.cookie, () =>
    schedulePostAction(p.id, PAST.toISOString(), { schedule: true }),
  );
  assert.equal(result.ok, false);
  assert.equal((await as(employee.cookie, () => setPostStatusAction(p.id, "scheduled"))).ok, false);
  const response = await callRoute(
    (r) => PATCH(r, { params: Promise.resolve({ id: String(p.id) }) }),
    jsonPost(
      "/api/posts/" + p.id,
      { status: "scheduled", scheduledFor: PAST.toISOString() },
      { cookie: employee.cookie },
    ),
  );
  assert.equal(response.status, 403);
  const api = provider();
  await publishDue({ now: NOW, fetch: api.fetch, ...FAST });
  assert.equal(api.creates, 0);
});
test("BUG05 employees may prepare edits but changing approved content cancels scheduling", async () => {
  const p = await approve(await post()),
    employee = await signIn("employee");
  assert.equal(
    (
      await as(employee.cookie, () =>
        savePostAction(p.id, { title: "Edited", expectedRevision: p.revision }),
      )
    ).ok,
    true,
  );
  const changed = await load(p.id);
  assert.equal(changed.status, "ready");
  assert.equal(changed.publishApprovedBy, null);
  const api = provider();
  await publishDue({ now: NOW, fetch: api.fetch, ...FAST });
  assert.equal(api.creates, 0);
});
test("BUG05 attachment replacement invalidates owner approval", async () => {
  const p = await approve(await post()),
    a = await image(),
    employee = await signIn("employee");
  assert.equal((await as(employee.cookie, () => attachAssetAction(p.id, a.id))).ok, true);
  assert.equal((await load(p.id)).status, "ready");
  assert.equal((await load(p.id)).publishApprovedRevision, null);
});
test("BUG05 scheduled legacy/raw rows cannot run without a durable owner approval", async () => {
  const p = await post({ status: "scheduled", scheduledFor: PAST }),
    api = provider();
  assert.equal(
    (await publishPost(p.id, { trigger: "due", now: NOW, fetch: api.fetch, ...FAST })).result,
    "skipped",
  );
  assert.equal(api.creates, 0);
});
test("BUG06 rejected, archived, unsorted and reassigned media stop before public copy or provider", async () => {
  for (const changed of [
    { status: "rejected" as const },
    { status: "archived" as const },
    { brandId: "b" },
    { brandId: null },
    { accountId: 999 },
  ]) {
    const a = await image(),
      p = await post({ format: "image_post" });
    await db.insert(postAssets).values({ postId: p.id, assetId: a.id, position: 1, role: "slide" });
    const approved = await approve(p);
    await db
      .update(assets)
      .set({ ...changed, publicUrl: null })
      .where(eq(assets.id, a.id));
    const api = provider();
    const outcome = await publishPost(approved.id, {
      trigger: "due",
      now: NOW,
      fetch: api.fetch,
      ...FAST,
    });
    assert.equal(outcome.result, "skipped");
    assert.equal(api.creates, 0);
    await db.delete(postAssets).where(eq(postAssets.postId, p.id));
    await db.delete(assets).where(eq(assets.id, a.id));
  }
});
test("BUG06 owner approval binds the approved SHA and local path; same-brand used reuse remains allowed", async () => {
  const a = await image(),
    p = await post({ format: "image_post" });
  await db.insert(postAssets).values({ postId: p.id, assetId: a.id, position: 1, role: "slide" });
  await approve(p);
  await db
    .update(assets)
    .set({ sha256: "b".repeat(64) })
    .where(eq(assets.id, a.id));
  const api = provider();
  assert.equal(
    (await publishPost(p.id, { trigger: "due", now: NOW, fetch: api.fetch, ...FAST })).result,
    "skipped",
  );
  await db.update(assets).set({ sha256: a.sha256, status: "used" }).where(eq(assets.id, a.id));
  const done = await publishPost(p.id, { trigger: "due", now: NOW, fetch: api.fetch, ...FAST });
  assert.equal(done.result, "published", JSON.stringify(done));
  assert.equal(api.creates, 1);
});
test("BUG07 linked account identity edits are refused and the connected destination stays intact", async () => {
  const owner = (await db.select().from(users).where(eq(users.id, ownerId)))[0];
  const token = await import("@/lib/auth/token");
  const cookie =
    token.SESSION_COOKIE +
    "=" +
    (await token.createSessionToken(owner.id, process.env.SESSION_SECRET!));
  const form = new FormData();
  for (const [k, v] of Object.entries({
    accountId: String(accountId),
    brandId: "b",
    platform: "facebook",
    handle: "changed",
    status: "active",
  }))
    form.set(k, v);
  const result = await as(cookie, () => saveAccountAction(null, form));
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.error, /Unlink/);
  const [a] = await db.select().from(socialAccounts).where(eq(socialAccounts.id, accountId));
  assert.equal(a.brandId, "a");
  assert.equal(a.externalId, "target-a");
});
test("BUG07 wrong-brand account and changed provider destination block before upload", async () => {
  const p = await approve(await post()),
    api = provider();
  await db
    .update(socialAccounts)
    .set({ externalId: "target-b" })
    .where(eq(socialAccounts.id, accountId));
  assert.equal(
    (await publishPost(p.id, { trigger: "due", now: NOW, fetch: api.fetch, ...FAST })).result,
    "skipped",
  );
  await db
    .update(socialAccounts)
    .set({ externalId: "target-a", brandId: "b" })
    .where(eq(socialAccounts.id, accountId));
  assert.equal(
    (await publishPost(p.id, { now: NOW, ownerId, fetch: api.fetch, ...FAST })).result,
    "skipped",
  );
  assert.equal(api.creates, 0);
});

test("BUG08 ten older pending containers cannot starve a newly due authorized post", async () => {
  const [metaAccount] = await db
    .select()
    .from(socialAccounts)
    .where(eq(socialAccounts.id, accountId));
  const [ig] = await insertReturning(db, socialAccounts, {
    brandId: metaAccount.brandId,
    status: metaAccount.status,
    integrationId: metaAccount.integrationId,
    platform: "instagram",
    handle: "synthetic_ig",
    externalId: "target-ig",
    isProfessional: true,
  });
  for (let n = 0; n < 10; n++) {
    const old = await approve(await post({ accountId: ig.id }));
    await db
      .update(posts)
      .set({
        status: "publishing",
        externalContainerId: "old-" + n,
        publishAttemptId: "00000000-0000-0000-0000-" + String(n).padStart(12, "0"),
        publishStartedAt: new Date(NOW.getTime() - 60 * 60_000),
        lastPublishAttemptAt: new Date(NOW.getTime() - 30 * 60_000),
      })
      .where(eq(posts.id, old.id));
  }
  const fresh = await approve(await post()),
    api = provider();
  const report = await publishDue({ limit: 1, now: NOW, fetch: api.fetch, ...FAST });
  assert.equal(report.outcomes.find((o) => o.postId === fresh.id)?.result, "published");
  assert.equal(api.creates, 1);
});
test("BUG08 repeated checks cannot extend a pending upload beyond its durable 24-hour start", async () => {
  const p = await approve(await post());
  await db
    .update(posts)
    .set({
      status: "publishing",
      externalContainerId: "old-container",
      publishAttemptId: "00000000-0000-0000-0000-000000000001",
      publishStartedAt: new Date(NOW.getTime() - 25 * 60 * 60_000),
      lastPublishAttemptAt: new Date(NOW.getTime() - 60_000),
    })
    .where(eq(posts.id, p.id));
  const api = provider(),
    report = await publishDue({ now: NOW, fetch: api.fetch, ...FAST });
  assert.equal(report.outcomes.find((o) => o.postId === p.id)?.result, "failed");
  const stopped = await load(p.id);
  assert.equal(stopped.publishState, "ambiguous");
  assert.equal(stopped.externalContainerId, "old-container");
  assert.equal(api.creates, 0);
});
test("BUG08 owner stop retains provider/session identity and blocks all further submissions", async () => {
  const p = await approve(await post());
  const session = {
    publishId: "saved-upload",
    uploadUrl: "https://example.invalid/signed",
    size: 10,
    chunkBytes: 10,
    uploadedBytes: 0,
    expiresAt: new Date(NOW.getTime() + 60 * 60_000).toISOString(),
  };
  await db
    .update(posts)
    .set({
      status: "publishing",
      externalContainerId: "saved-upload",
      publishAttemptId: "00000000-0000-0000-0000-000000000001",
      publishUpload: session,
      publishStartedAt: NOW,
    })
    .where(eq(posts.id, p.id));
  const employee = await signIn("employee");
  assert.equal((await as(employee.cookie, () => stopPublishingAction(p.id, p.revision))).ok, false);
  assert.equal((await as(ownerCookie, () => stopPublishingAction(p.id, p.revision - 1))).ok, false);
  assert.equal((await as(ownerCookie, () => stopPublishingAction(p.id, p.revision))).ok, true);
  const stopped = await load(p.id);
  assert.equal(stopped.status, "failed");
  assert.equal(stopped.publishState, "ambiguous");
  assert.equal(stopped.externalContainerId, "saved-upload");
  assert.deepEqual(stopped.publishUpload, session);
  assert.equal(stopped.publishApprovedBy, null);
  const api = provider();
  assert.equal(
    (await publishPost(p.id, { now: NOW, ownerId, fetch: api.fetch, ...FAST })).result,
    "skipped",
  );
  await publishDue({ now: NOW, fetch: api.fetch, ...FAST });
  assert.equal(api.creates, 0);
});
test("BUG08 a late confirmed provider result is still recorded after a local stop", async () => {
  const p = await approve(await post());
  const api = provider({
    beforeResult: async () => {
      const active = await load(p.id);
      assert.equal(
        (await as(ownerCookie, () => stopPublishingAction(p.id, active.revision))).ok,
        true,
      );
    },
  });
  assert.equal(
    (await publishPost(p.id, { trigger: "due", now: NOW, fetch: api.fetch, ...FAST })).result,
    "published",
  );
  const saved = await load(p.id);
  assert.equal(saved.publishState, "confirmed");
  assert.equal(saved.externalMediaId, "live-1");
  assert.equal(api.creates, 1);
});
