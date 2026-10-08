import { insertReturning } from "@/db/mutations";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, beforeEach, test } from "node:test";

import { eq } from "drizzle-orm";

import { db, schema } from "@/db";
import { GET as exportLessons } from "@/app/lessons/export/route";
import { listLessons } from "@/lib/bridge/lessons";
import {
  analyzeWithoutCaptionsAction,
  deleteLessonAction,
  fallbackEstimateAction,
  lessonBrandOptionsAction,
  saveLessonAction,
} from "@/lib/lessons.actions";
import { reservedUsd } from "@/lib/spend";

import { callRoute, signIn } from "./route";
import { resetTables, teardown } from "./setup";

/**
 * S11's server actions and export route (PLAN.md §6.S11): saving and
 * deleting lessons, the Markdown export, and the owner-only no-captions
 * fallback against the Gemini fake. Same `as()` harness as ideas.test.ts: the
 * actions read the session through `cookies()`, and `revalidatePath` needs an
 * `incrementalCache` on the work store.
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
    new Request("http://localhost/lessons", { method: "POST", headers: { cookie } }),
  );
  if (error) throw error;
  return result as T;
}

const BRAND = "residency-guide";
let owner = "";
let employee = "";

async function video(durationSeconds: number | null = 20 * 60) {
  const [row] = await insertReturning(db, schema.videos, {
    youtubeId: "vid00000001",
    title: "The 45-day timeline",
    channelTitle: "Expat Desk",
    durationSeconds,
    captionStatus: "none",
  });
  return row;
}

beforeEach(async () => {
  process.env.MONTHLY_SPEND_CAP_USD = "5";
  await resetTables();
  await db.insert(schema.brands).values({
    id: BRAND,
    name: "Residency Guide",
    domain: "residency.example",
    niche: "residency",
    market: "paraguay",
    platforms: ["instagram"],
  });
  owner = (await signIn("owner")).cookie;
  employee = (await signIn("employee")).cookie;
});
after(async () => {
  delete process.env.MONTHLY_SPEND_CAP_USD;
  await teardown();
});

test("saveLessonAction saves for any signed-in user, with brand, video and timestamp", async () => {
  const v = await video();
  const res = await as(employee, () =>
    saveLessonAction({
      text: "  Open with the date.  ",
      kind: "hook",
      brandId: BRAND,
      videoId: v.id,
      timestampSec: 83.7,
    }),
  );
  assert.ok(res.ok);
  const [row] = await listLessons();
  assert.equal(row.id, res.id);
  assert.equal(row.text, "Open with the date.");
  assert.equal(row.kind, "hook");
  assert.equal(row.brandId, BRAND);
  assert.equal(row.videoId, v.id);
  assert.equal(row.timestampSec, 83);

  const plain = await as(owner, () =>
    saveLessonAction({ text: "Portfolio-wide", kind: "fact", brandId: "" }),
  );
  assert.ok(plain.ok);
  assert.equal((await listLessons({ brandId: null }))[0]?.text, "Portfolio-wide");

  assert.deepEqual(await as(employee, () => lessonBrandOptionsAction()), [
    { id: BRAND, name: "Residency Guide" },
  ]);
});

test("saveLessonAction refuses bad input without writing", async () => {
  const bad = [
    { text: "   ", kind: "lesson" },
    { text: "x", kind: "rumour" },
    { text: "x", kind: "lesson", brandId: "no-such-brand" },
    { text: "x", kind: "lesson", videoId: -1 },
    { text: "x", kind: "lesson", timestampSec: Number.NaN },
  ] as Parameters<typeof saveLessonAction>[0][];
  for (const input of bad) {
    const res = await as(owner, () => saveLessonAction(input));
    assert.equal(res.ok, false, JSON.stringify(input));
  }
  assert.equal((await listLessons()).length, 0);
  await assert.rejects(
    as("", () => saveLessonAction({ text: "x", kind: "lesson" })),
    /redirect/,
  );
});

test("deleteLessonAction removes one lesson and reports a missing one", async () => {
  const res = await as(owner, () => saveLessonAction({ text: "Gone soon", kind: "lesson" }));
  assert.ok(res.ok);
  assert.deepEqual(await as(employee, () => deleteLessonAction(res.id)), { ok: true });
  assert.equal((await listLessons()).length, 0);
  const again = await as(employee, () => deleteLessonAction(res.id));
  assert.equal(again.ok, false);
});

test("the export route returns Markdown grouped by kind, video linked at &t=", async () => {
  const v = await video();
  await as(owner, () =>
    saveLessonAction({
      text: "Say the date first",
      kind: "hook",
      brandId: BRAND,
      videoId: v.id,
      timestampSec: 95,
    }),
  );
  await as(owner, () =>
    saveLessonAction({ text: "45 days, not 90", kind: "fact", brandId: BRAND, videoId: v.id }),
  );
  await as(owner, () => saveLessonAction({ text: "Unbranded lesson", kind: "lesson" }));

  const res = await callRoute(
    exportLessons,
    new Request(`http://localhost/lessons/export?brand=${BRAND}`, { headers: { cookie: owner } }),
  );
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /text\/markdown/);
  const md = await res.text();
  assert.match(
    md,
    /## Hooks\n\n- Say the date first — \[The 45-day timeline @ 1:35\]\(https:\/\/www\.youtube\.com\/watch\?v=vid00000001&t=95s\)/,
  );
  assert.match(
    md,
    /## Facts\n\n- 45 days, not 90 — \[The 45-day timeline\]\(https:\/\/www\.youtube\.com\/watch\?v=vid00000001\)/,
  );
  assert.ok(md.indexOf("## Hooks") < md.indexOf("## Facts"), "kinds in their fixed order");
  assert.doesNotMatch(md, /Unbranded lesson/, "the brand filter applies");

  const kindOnly = await (
    await callRoute(
      exportLessons,
      new Request("http://localhost/lessons/export?kind=lesson", { headers: { cookie: owner } }),
    )
  ).text();
  assert.match(kindOnly, /Unbranded lesson/);
  assert.doesNotMatch(kindOnly, /Say the date first/);

  const signedOut = await callRoute(exportLessons, new Request("http://localhost/lessons/export"));
  assert.equal(signedOut.status, 401);
});

test("fallback: owner only, estimate first, then the analysis through the fake", async () => {
  const v = await video();

  const denied = await as(employee, () => fallbackEstimateAction(v.id));
  assert.equal(denied.ok, false);
  const deniedRun = await as(employee, () => analyzeWithoutCaptionsAction(v.id));
  assert.equal(deniedRun.ok, false);
  assert.equal((await db.select().from(schema.analyses)).length, 0, "an employee spends nothing");

  const estimate = await as(owner, () => fallbackEstimateAction(v.id));
  assert.ok(estimate.ok);
  assert.match(estimate.estimate, /^\$\d/);

  const run = await as(owner, () => analyzeWithoutCaptionsAction(v.id));
  assert.ok(run.ok, run.ok ? "" : run.error);
  assert.match(run.message, /Analysed for \$/);
  const rows = await db.select().from(schema.analyses).where(eq(schema.analyses.videoId, v.id));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "ok");
  assert.equal(await reservedUsd(), 0, "the reservation is released");

  const repeat = await as(owner, () => analyzeWithoutCaptionsAction(v.id));
  assert.ok(repeat.ok);
  assert.match(repeat.message, /nothing was spent/);
});

test("fallback refusals come back as error text", async () => {
  const unknown = await video(null);
  const est = await as(owner, () => fallbackEstimateAction(unknown.id));
  assert.equal(est.ok, false);
  assert.ok(!est.ok && est.error.length > 0);
  const run = await as(owner, () => analyzeWithoutCaptionsAction(unknown.id));
  assert.equal(run.ok, false);

  const missing = await as(owner, () => analyzeWithoutCaptionsAction(999_999));
  assert.ok(!missing.ok && /No video/.test(missing.error));
});
