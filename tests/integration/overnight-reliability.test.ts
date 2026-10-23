import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { insertReturning } from "@/db/mutations";
import {
  acquireLease,
  assertLeaseCurrent,
  releaseLease,
  renewLease,
  withLeaseCommit,
} from "@/lib/lease";
import { saveClip } from "@/lib/clips/save";
import { failStaleRenders } from "@/lib/video/queries";
import { consumeLoginAttempt, LOGIN_ACCOUNT_LIMIT } from "@/lib/auth/throttle";
import { revokeSession, sessionRevoked } from "@/lib/auth/revocation";
import { prunePublic, publishCopy } from "@/lib/media/public";
import type { StorageDriver } from "@/lib/storage/driver";
import { approveSharedMediaIdentity } from "@/lib/media/privacy";
import { structuredJson } from "@/lib/ai";
import { resetTables, teardown } from "./setup";

let root = "";
const previousRoot = process.env.MEDIA_ROOT;
beforeEach(async () => {
  await resetTables();
  if (root) await rm(root, { recursive: true, force: true });
  root = await mkdtemp(path.join(tmpdir(), "cm-overnight-"));
  process.env.MEDIA_ROOT = root;
});
after(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  if (previousRoot === undefined) delete process.env.MEDIA_ROOT;
  else process.env.MEDIA_ROOT = previousRoot;
  await teardown();
});
test("expired lease cannot renew or commit after takeover", async () => {
  const old = (await acquireLease("fence-regression", 60_000))!;
  await db
    .update(schema.leases)
    .set({ expiresAt: sql`date_sub(current_timestamp(3), interval 1 second)` })
    .where(eq(schema.leases.name, old.name));
  const current = (await acquireLease(old.name, 60_000))!;
  assert.notEqual(current.holder, old.holder);
  assert.equal(await renewLease(old, 60_000), false);
  await assert.rejects(assertLeaseCurrent(old), /ownership/);
  await assert.rejects(
    withLeaseCommit(old, async () => "wrong"),
    /ownership/,
  );
  await releaseLease(old);
  await assertLeaseCurrent(current);
  assert.equal(await withLeaseCommit(current, async () => "owned"), "owned");
});
test("simultaneous first captures report one creation and preserve one row", async () => {
  const results = await Promise.all(
    Array.from({ length: 8 }, () =>
      saveClip({ url: "https://example.invalid/synthetic-clip", purpose: "learn" }),
    ),
  );
  assert.equal(results.filter((r) => r.ok && r.created).length, 1);
  assert.equal((await db.select().from(schema.clips)).length, 1);
});
test("render stale recovery keeps live owned work but reaps an expired attempt", async () => {
  const [row] = await insertReturning(db, schema.videoRenders, {
    ownerKind: "script",
    ownerRef: "synthetic",
    language: "en",
    format: "16x9",
    status: "queued",
    plan: {},
    createdAt: new Date("2020-01-01"),
  });
  const owner = (await acquireLease(`render:${row.id}`, 60_000))!;
  assert.equal(await failStaleRenders(), 0);
  await releaseLease(owner);
  assert.equal(await failStaleRenders(), 1);
});
test("login throttling serializes attempts and expires without email storage", async () => {
  const results = await Promise.all(
    Array.from({ length: 12 }, () => consumeLoginAttempt("synthetic@example.invalid")),
  );
  assert.equal(results.filter(Boolean).length, LOGIN_ACCOUNT_LIMIT);
  await db
    .update(schema.applicationSettings)
    .set({ value: { started: 0, count: 99 } })
    .where(sql`${schema.applicationSettings.key} like 'auth:%'`);
  assert.equal(await consumeLoginAttempt("synthetic@example.invalid"), true);
});
test("logout revocation survives another request and is scoped to the token", async () => {
  await revokeSession("synthetic-cookie-one", Date.now() + 60_000);
  assert.equal(await sessionRevoked("synthetic-cookie-one"), true);
  assert.equal(await sessionRevoked("synthetic-cookie-two"), false);
  const rows = await db.select().from(schema.applicationSettings);
  assert.equal(JSON.stringify(rows).includes("synthetic-cookie-one"), false);
});

test("a throttle waiter samples time after the serialized window update", async () => {
  let release!: () => void, locked!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const ready = new Promise<void>((resolve) => (locked = resolve));
  const blocking = db.transaction(async (tx) => {
    await tx.insert(schema.applicationSettings).values({
      key: "auth:global",
      value: { started: Date.now() + 500, count: 120 },
      updatedAt: new Date(),
    });
    locked();
    await gate;
  });
  await ready;
  const attempt = consumeLoginAttempt("waiter@example.invalid");
  try {
    await new Promise((resolve) => setTimeout(resolve, 1000));
  } finally {
    release();
  }
  await blocking;
  assert.equal(await attempt, false, "a pre-lock clock must not reset the full window");
});
test("strict grounding refuses before creating a paid reservation or fake dispatch", async () => {
  const previous = process.env.GROUNDING_BUDGET_MODE;
  process.env.GROUNDING_BUDGET_MODE = "strict";
  try {
    await assert.rejects(
      structuredJson({
        system: "synthetic",
        prompt: "synthetic",
        schema: {},
        webSearch: true,
        estimateUsd: 1,
        maxOutputTokens: 10,
      }),
      /cannot be bounded/,
    );
    assert.equal((await db.select().from(schema.spendHolds)).length, 0);
    assert.equal((await db.select().from(schema.spendLog)).length, 0);
  } finally {
    if (previous === undefined) delete process.env.GROUNDING_BUDGET_MODE;
    else process.env.GROUNDING_BUDGET_MODE = previous;
  }
});
test("prune and renewal serialize so the replacement public copy remains recorded", async () => {
  const bytes = Buffer.from("synthetic-image-bytes");
  const sha = createHash("sha256").update(bytes).digest("hex");
  const oldUrl = "https://media.example.invalid/files/2026/09/" + "1".repeat(32) + ".png";
  const newUrl = "https://media.example.invalid/files/2026/09/" + "2".repeat(32) + ".png";
  const [asset] = await insertReturning(db, schema.assets, {
    kind: "image",
    mime: "image/png",
    bytes: bytes.length,
    sha256: sha,
    localPath: "synthetic.png",
    source: "import",
    publicUrl: oldUrl,
    publicExpiresAt: new Date("2020-01-01"),
  });
  await approveSharedMediaIdentity(sha, root);
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>((r) => (enter = r)),
    gate = new Promise<void>((r) => (release = r));
  const driver = {
    remove: async () => {
      enter();
      await gate;
      return { ok: true };
    },
    put: async () => ({ ok: true, key: "synthetic", url: newUrl }),
    get: async () => ({ ok: true, data: bytes }),
  } as unknown as StorageDriver;
  const prune = prunePublic({ driver });
  await entered;
  const renew = publishCopy(asset.id, { drivers: { local: driver, public: driver } });
  release();
  const [pruned, renewed] = await Promise.all([prune, renew]);
  assert.equal(pruned.status, "ok");
  assert.equal(renewed.status, "published");
  const [saved] = await db.select().from(schema.assets).where(eq(schema.assets.id, asset.id));
  assert.equal(saved.publicUrl, newUrl);
  assert.ok(saved.publicExpiresAt! > new Date());
});
