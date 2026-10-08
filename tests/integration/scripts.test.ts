import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";

import { eq, sql } from "drizzle-orm";

import { db, schema } from "@/db";
import {
  createScript,
  getScript,
  InvalidScriptError,
  listScripts,
  setScriptStatus,
  updateScriptBody,
  type ScriptBodyValidator,
} from "@/lib/bridge/scripts";

import { resetTables, teardown } from "./setup";

/**
 * `bridge/scripts.ts` (PLAN.md §1.32, §5.O7.3). The body contract is O8's, so
 * these tests pass a stand-in validator — what they prove is that the bridge
 * calls it on every write and refuses what it rejects.
 */

beforeEach(resetTables);
after(teardown);

const calls: unknown[] = [];
const acceptVersion1: ScriptBodyValidator = (body) => {
  calls.push(body);
  return typeof body === "object" && body !== null && (body as { version?: unknown }).version === 1
    ? { ok: true }
    : { ok: false, errors: ["version must be 1"] };
};

const BODY = {
  version: 1,
  hook: "Everyone still says 90 days.",
  sections: [{ spoken: ["Line one."] }],
};

async function draft(brandId = "residency", title = "The 45-day timeline") {
  return createScript({ brandId, title, language: "en", body: BODY }, acceptVersion1);
}

test("createScript validates the body and stores it as JSON, untouched", async () => {
  calls.length = 0;
  const script = await draft();
  assert.equal(calls.length, 1, "the validator ran");
  assert.equal(script.status, "draft");
  assert.deepEqual(script.body, BODY);
  assert.equal(script.recordedAt, null);

  const [{ type }] = await db
    .select({ type: sql<string>`json_type(${schema.scripts.body})` })
    .from(schema.scripts)
    .where(eq(schema.scripts.id, script.id));
  assert.equal(type, "OBJECT", "stored as a JSON object, not a JSON string");

  await assert.rejects(
    createScript(
      { brandId: "x", title: "t", language: "en", body: { version: 2 } },
      acceptVersion1,
    ),
    (err: unknown) => err instanceof InvalidScriptError && err.errors[0] === "version must be 1",
  );
  await assert.rejects(
    createScript({ brandId: "x", title: "  ", language: "en", body: BODY }, acceptVersion1),
    InvalidScriptError,
  );
  assert.equal((await listScripts()).length, 1, "nothing rejected was written");
});

test("getScript and listScripts by brand and status, most recently edited first", async () => {
  const a = await draft("residency", "A");
  const b = await draft("residency", "B");
  const c = await draft("pozo", "C");
  await setScriptStatus(b.id, "ready");

  assert.equal((await getScript(a.id))?.title, "A");
  assert.equal(await getScript(9999), null);

  assert.deepEqual(
    (await listScripts()).map((s) => s.title),
    ["B", "C", "A"],
  );
  assert.deepEqual(
    (await listScripts({ brandId: "residency" })).map((s) => s.id),
    [b.id, a.id],
  );
  assert.deepEqual(
    (await listScripts({ status: "draft" })).map((s) => s.id),
    [c.id, a.id],
  );
  assert.deepEqual(
    (await listScripts({ brandId: "residency", status: "ready" })).map((s) => s.id),
    [b.id],
  );
});

test("updateScriptBody validates, patches title/language, bumps updated_at", async () => {
  const script = await draft();
  await db
    .update(schema.scripts)
    .set({ updatedAt: sql`now() - interval '1 hour'` })
    .where(eq(schema.scripts.id, script.id));

  const next = { ...BODY, hook: "New hook" };
  const updated = await updateScriptBody(script.id, next, acceptVersion1, {
    title: " Retitled ",
    language: "es-PY",
  });
  assert.ok(updated);
  assert.deepEqual(updated.body, next);
  assert.equal(updated.title, "Retitled");
  assert.equal(updated.language, "es-PY");
  assert.ok(Date.now() - updated.updatedAt.getTime() < 60_000, "updated_at moved to now");

  await assert.rejects(
    updateScriptBody(script.id, { version: 0 }, acceptVersion1),
    InvalidScriptError,
  );
  assert.deepEqual((await getScript(script.id))?.body, next, "a rejected body changes nothing");
  assert.equal(await updateScriptBody(9999, BODY, acceptVersion1), null);
});

test("setScriptStatus stamps on the way in, keeps on repeat, clears on the way out", async () => {
  const script = await draft();

  const ready = await setScriptStatus(script.id, "ready");
  assert.equal(ready?.recordedAt, null);

  const recorded = await setScriptStatus(script.id, "recorded");
  assert.ok(recorded?.recordedAt);
  assert.equal(recorded.postedAt, null);

  // Backdate, then repeat: a repeat keeps the original stamp.
  await db
    .update(schema.scripts)
    .set({ recordedAt: sql`now() - interval '2 days'` })
    .where(eq(schema.scripts.id, script.id));
  const stamped = (await getScript(script.id))!.recordedAt!;
  const again = await setScriptStatus(script.id, "recorded");
  assert.equal(again?.recordedAt?.getTime(), stamped.getTime());

  const posted = await setScriptStatus(script.id, "posted");
  assert.ok(posted?.postedAt);
  assert.equal(posted.recordedAt?.getTime(), stamped.getTime(), "posting keeps the recording date");

  const back = await setScriptStatus(script.id, "draft");
  assert.equal(back?.recordedAt, null);
  assert.equal(back?.postedAt, null);

  // Straight to posted: posting implies it was recorded.
  const direct = await setScriptStatus((await draft()).id, "posted");
  assert.ok(direct?.recordedAt && direct.postedAt);

  await assert.rejects(setScriptStatus(script.id, "archived" as never), InvalidScriptError);
  assert.equal(await setScriptStatus(9999, "ready"), null);
});
