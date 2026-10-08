import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { after, afterEach, beforeEach, test } from "node:test";
import { promisify } from "node:util";

import { eq, sql } from "drizzle-orm";

import { db, schema } from "@/db";
import { GET as pollRoute } from "@/app/api/cron/poll/route";
import { acquireLease, POLL_LEASE, releaseLease, withLease } from "@/lib/lease";
import { CLIP_INGEST_TIMEOUT_ERROR, pollSources } from "@/lib/poll";

import { callRoute } from "./route";
import { resetTables, teardown } from "./setup";

/**
 * The `poll` lease (PLAN.md §1.19) and the clip reaper (§1.21).
 *
 * The lease replaced a module variable that only ever saw its own process, so
 * the tests that matter are the ones a module variable would also have passed
 * and the ones it could not: two overlapping calls into the same handler, and
 * a CLI run in a separate process refusing while the lease is held elsewhere.
 */

const SECRET = "lease-test-cron-secret";
const realFetch = globalThis.fetch;

function cronRequest(): Request {
  // analyze=false: this file is about who may run, not what a run spends.
  return new Request("http://localhost/api/cron/poll?analyze=false", {
    headers: { "x-cron-secret": SECRET },
  });
}

async function leaseRows() {
  return db.select().from(schema.leases);
}

beforeEach(async () => {
  process.env.CRON_SECRET = SECRET;
  process.env.YOUTUBE_API_KEY = "test-key";
  await resetTables();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

after(async () => {
  delete process.env.CRON_SECRET;
  delete process.env.YOUTUBE_API_KEY;
  await teardown();
});

test("two overlapping poll calls: one runs, the other is 409", async () => {
  // One active source whose YouTube call hangs until released — so the first
  // run is provably still inside the lease when the second one arrives.
  await db.insert(schema.sources).values({
    kind: "channel",
    youtubeId: "UCleasetest000000000000",
    title: "Slow channel",
    url: "https://www.youtube.com/channel/UCleasetest000000000000",
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let entered!: () => void;
  const inside = new Promise<void>((resolve) => (entered = resolve));
  globalThis.fetch = (async () => {
    entered();
    await gate;
    return new Response(JSON.stringify({ items: [] }), { status: 200 });
  }) as typeof globalThis.fetch;

  const first = callRoute(pollRoute, cronRequest());
  await inside;

  const second = await callRoute(pollRoute, cronRequest());
  assert.equal(second.status, 409);
  assert.match(((await second.json()) as { error: string }).error, /already running/);
  assert.equal((await leaseRows()).length, 1, "the first run still holds the lease");

  release();
  const firstResponse = await first;
  assert.equal(firstResponse.status, 200);
  assert.equal((await leaseRows()).length, 0, "released in finally");

  // And once released, the next hourly run goes through.
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ items: [] }), { status: 200 })) as typeof globalThis.fetch;
  assert.equal((await callRoute(pollRoute, cronRequest())).status, 200);
});

test("concurrent withLease calls: exactly one acquires", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const runs = Array.from({ length: 5 }, () => withLease("race", 60_000, () => gate));
  // Let every acquire land before anyone releases.
  await new Promise((resolve) => setTimeout(resolve, 100));
  release();
  const outcomes = await Promise.all(runs);
  assert.equal(outcomes.filter((o) => o.acquired).length, 1);
});

test("an expired lease is taken over; a live one is not", async () => {
  const live = await acquireLease("job", 60_000);
  assert.ok(live);
  assert.equal(await acquireLease("job", 60_000), null);

  // A crashed holder never releases: simulate it by backdating the expiry.
  await db
    .update(schema.leases)
    .set({ expiresAt: sql`now() - interval '1 second'` })
    .where(eq(schema.leases.name, "job"));
  const takeover = await acquireLease("job", 60_000);
  assert.ok(takeover, "an expired lease is anyone's");
  assert.notEqual(takeover.holder, live.holder);

  // The old holder waking up late must not free its successor's lease.
  await releaseLease(live);
  assert.equal((await leaseRows()).length, 1);
  await releaseLease(takeover);
  assert.equal((await leaseRows()).length, 0);
});

test("a throwing run releases the lease at once, not after the TTL", async () => {
  await assert.rejects(
    withLease("job", 60_000, async () => {
      throw new Error("boom");
    }),
    /boom/,
  );
  assert.equal((await leaseRows()).length, 0);
  assert.ok(await acquireLease("job", 60_000));
});

test("npm run yt:poll exits 0 with 'already running' while the lease is held", async () => {
  const held = await acquireLease(POLL_LEASE, 60_000);
  assert.ok(held);

  const { stdout } = await promisify(execFile)(
    process.execPath,
    ["--import", "tsx", "scripts/poll-sources.ts", "--no-analyze"],
    { env: { ...process.env }, timeout: 60_000 },
  );
  assert.match(stdout, /already running/);
  const [row] = await leaseRows();
  assert.equal(row.holder, held.holder, "the CLI left someone else's lease alone");
});

test("the poll run fails clips stuck in ingesting for over 15 minutes", async () => {
  await db.insert(schema.clips).values([
    {
      url: "https://youtu.be/stuck000001",
      platform: "youtube",
      status: "ingesting",
      savedAt: sql`now() - interval '20 minutes'`,
    },
    {
      url: "https://youtu.be/fresh000001",
      platform: "youtube",
      status: "ingesting",
      savedAt: sql`now() - interval '1 minute'`,
    },
    {
      url: "https://youtu.be/idle0000001",
      platform: "youtube",
      status: "unprocessed",
      savedAt: sql`now() - interval '2 hours'`,
    },
  ]);

  const result = await pollSources({ analyze: false });
  assert.equal(result.reapedClips, 1);

  const byUrl = new Map((await db.select().from(schema.clips)).map((c) => [c.url, c]));
  const stuck = byUrl.get("https://youtu.be/stuck000001")!;
  assert.equal(stuck.status, "failed");
  assert.equal(stuck.error, CLIP_INGEST_TIMEOUT_ERROR);
  assert.equal(byUrl.get("https://youtu.be/fresh000001")!.status, "ingesting", "still in time");
  assert.equal(byUrl.get("https://youtu.be/idle0000001")!.status, "unprocessed", "not ingesting");

  // A second run finds nothing left to reap.
  assert.equal((await pollSources({ analyze: false })).reapedClips, 0);
});

test("the reaper times a retried old clip from its ingest start, not its save", async () => {
  await db.insert(schema.clips).values([
    {
      // Saved a month ago, retried a minute ago: in time.
      url: "https://youtu.be/retried0001",
      platform: "youtube",
      status: "ingesting",
      savedAt: sql`now() - interval '30 days'`,
      ingestStartedAt: sql`now() - interval '1 minute'`,
    },
    {
      // Saved a minute ago but its ingest started 20 minutes back cannot
      // happen in practice; it pins that the start time, not the save, decides.
      url: "https://youtu.be/started0001",
      platform: "youtube",
      status: "ingesting",
      savedAt: sql`now() - interval '1 minute'`,
      ingestStartedAt: sql`now() - interval '20 minutes'`,
    },
  ]);

  assert.equal((await pollSources({ analyze: false })).reapedClips, 1);
  const byUrl = new Map((await db.select().from(schema.clips)).map((c) => [c.url, c]));
  assert.equal(byUrl.get("https://youtu.be/retried0001")!.status, "ingesting");
  assert.equal(byUrl.get("https://youtu.be/started0001")!.status, "failed");
});
