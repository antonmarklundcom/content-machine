import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { createPool } from "mysql2/promise";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { databaseOptions } from "@/db/driver";
import { insertReturning } from "@/db/mutations";
import { acquireLease, releaseLease } from "@/lib/lease";
import { clipWorkLease } from "@/lib/clips/work";
import { SAVE_SQL } from "../../workers/telegram-capture/src/handler";
import { WORKER_CONNECTION_FLAGS } from "../../workers/telegram-capture/src/mysql";
import { workerQueryFromPool } from "./worker-db";
import { resetTables, teardown } from "./setup";

const pool = createPool({
  ...databaseOptions(process.env.DATABASE_URL),
  flags: WORKER_CONNECTION_FLAGS,
});
const query = workerQueryFromPool(pool);
beforeEach(resetTables);
after(async () => {
  await pool.end();
  await teardown();
});

test("Telegram duplicate notes share web clip ownership and invalidate learning only after safe retry", async () => {
  const [clip] = await insertReturning(db, schema.clips, {
    url: "https://synthetic.invalid/worker-note",
    note: "Original context",
    purpose: "learn",
    summary: "Old learned output",
    learnCategory: "learning-resource",
    howToStart: ["Old step"],
    learnDetails: { takeaways: ["Old takeaway"], resources: [], limitations: [] },
  });
  const args = [clip.url, "other", "New context", null, "learn", "[]", null];
  const lease = await acquireLease(clipWorkLease(clip.id), 60_000);
  assert.ok(lease);
  try {
    assert.deepEqual(await query(SAVE_SQL, args), [{ id: clip.id, created: false, busy: true }]);
    const [unchanged] = await db.select().from(schema.clips).where(eq(schema.clips.id, clip.id));
    assert.equal(unchanged.note, clip.note);
    assert.equal(unchanged.summary, clip.summary);
    assert.deepEqual(
      await query(SAVE_SQL, [clip.url, "other", clip.note, null, "learn", "[]", null]),
      [{ id: clip.id, created: false }],
    );
  } finally {
    await releaseLease(lease);
  }
  assert.deepEqual(await query(SAVE_SQL, args), [{ id: clip.id, created: false }]);
  const [updated] = await db.select().from(schema.clips).where(eq(schema.clips.id, clip.id));
  assert.equal(updated.note, "New context");
  for (const value of [
    updated.summary,
    updated.learnCategory,
    updated.howToStart,
    updated.learnDetails,
  ])
    assert.equal(value, null);
  assert.equal(
    (
      await db
        .select()
        .from(schema.leases)
        .where(eq(schema.leases.name, clipWorkLease(clip.id)))
    ).length,
    0,
  );
});
