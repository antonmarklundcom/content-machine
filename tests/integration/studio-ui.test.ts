import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, beforeEach, test } from "node:test";

import { db, schema } from "@/db";
import { GET as exportScript } from "@/app/api/scripts/[id]/export/route";
import { POST as writeScript } from "@/app/api/scripts/route";
import { normalizeBody } from "@/app/studio/model";
import { getScript } from "@/lib/bridge/scripts";
import type { ScriptBodyV1 } from "@/lib/scripts/contract";
import type { ShotList } from "@/lib/scripts/export";
import { saveScript, setStudioScriptStatus } from "@/lib/studio.actions";

import { callRoute, jsonPost, signIn } from "./route";
import { resetTables, teardown } from "./setup";

/**
 * The script studio's loop (PLAN.md §6.S12 exit): create through O8's route
 * (the brief form's "Write script"), edit through `saveScript` (the editor),
 * move the status, and export what was saved.
 *
 * The actions read the session through `cookies()` and call `revalidatePath`,
 * so each runs inside `callRoute` with a stubbed `incrementalCache` — the same
 * harness as ideas.test.ts.
 */

const { workAsyncStorage } = createRequire(import.meta.url)(
  "next/dist/server/app-render/work-async-storage.external",
) as { workAsyncStorage: { getStore(): Record<string, unknown> | undefined } };

const BRAND = {
  id: "residency-guide",
  name: "Paraguay Residency Guide",
  domain: "paraguayresidencyguide.com",
  niche: "residency",
  market: "global",
  language: "es",
  voice: "Trustworthy expat guide.",
  platforms: ["youtube"],
};

let revalidated: string[] = [];

async function as<T>(cookie: string, action: () => Promise<T>): Promise<T> {
  let result: T | undefined;
  let error: unknown;
  await callRoute(
    async () => {
      const store = workAsyncStorage.getStore()!;
      store.incrementalCache = {};
      try {
        result = await action();
      } catch (e) {
        error = e;
      }
      revalidated = (store.pendingRevalidatedTags as string[] | undefined) ?? [];
      return new Response(null);
    },
    new Request("http://localhost/studio", { method: "POST", headers: { cookie } }),
  );
  if (error) throw error;
  return result as T;
}

let owner = "";
let employee = "";

beforeEach(async () => {
  process.env.MONTHLY_SPEND_CAP_USD = "5";
  await resetTables();
  await db.insert(schema.brands).values(BRAND);
  owner = (await signIn("owner")).cookie;
  employee = (await signIn("employee")).cookie;
});

after(async () => {
  delete process.env.MONTHLY_SPEND_CAP_USD;
  await teardown();
});

/** What the brief form's "Write script" posts, against the Gemini fake. */
async function createDraft(): Promise<{ id: number; body: ScriptBodyV1 }> {
  const response = await callRoute(
    writeScript,
    jsonPost(
      "/api/scripts",
      {
        brandId: BRAND.id,
        topic: "Residency timeline",
        title: "Paraguay residency in 45 days",
        targetMinutes: 6,
        competitorVideoIds: [],
        lessonIds: [],
      },
      { cookie: owner },
    ),
  );
  assert.equal(response.status, 201);
  const { script } = (await response.json()) as {
    script: { id: number; body: ScriptBodyV1; status: string };
  };
  assert.equal(script.status, "draft");
  return { id: script.id, body: script.body };
}

function exportRequest(id: number, query: string): Request {
  return new Request(`http://localhost/api/scripts/${id}/export?${query}`, {
    headers: { cookie: employee },
  });
}

test("create → edit → status → export", async () => {
  const { id, body } = await createDraft();

  // Edit the way the editor does: rows typed with blanks, a new shot with an
  // empty video prompt, a new title. normalizeBody tidies before the save.
  const edited = structuredClone(body);
  edited.chosenTitle = "Residency in 45 days, not 90";
  edited.sections[0]!.spokenLines = [
    "  This line was edited in the studio.  ",
    "",
    ...edited.sections[0]!.spokenLines,
  ];
  edited.sections[0]!.broll.push({
    spokenLine: "This line was edited in the studio.",
    description: "Studio desk close-up",
    imagePrompt: "A tidy desk with a passport",
    videoPrompt: "",
    aspectRatio: "16:9",
  });
  const saved = await as(employee, () => saveScript(id, normalizeBody(edited)));
  assert.ok(saved.ok, "a valid edit saves");
  assert.equal(
    saved.script.title,
    "Residency in 45 days, not 90",
    "the title column follows the body",
  );
  assert.deepEqual(revalidated.sort(), ["_N_T_/studio", `_N_T_/studio/${id}`]);

  const stored = (await getScript(id))!.body as ScriptBodyV1;
  assert.equal(stored.sections[0]!.spokenLines[0], "This line was edited in the studio.");
  assert.equal(
    stored.sections[0]!.broll.at(-1)!.videoPrompt,
    null,
    "an empty video prompt is a still",
  );

  const ready = await as(employee, () => setStudioScriptStatus(id, "ready"));
  assert.equal(ready.status, "ready");
  const recorded = await as(owner, () => setStudioScriptStatus(id, "recorded"));
  assert.ok(recorded.recordedAt instanceof Date, "recorded_at stamped");

  const md = await callRoute(
    (r) => exportScript(r, { params: Promise.resolve({ id: String(id) }) }),
    exportRequest(id, "format=md"),
  );
  assert.equal(md.status, 200);
  const text = await md.text();
  assert.match(text, /^# Residency in 45 days, not 90/);
  assert.match(text, /This line was edited in the studio\./);
  assert.match(text, /recorded · script/);

  const shots = await callRoute(
    (r) => exportScript(r, { params: Promise.resolve({ id: String(id) }) }),
    exportRequest(id, "format=shots&as=json"),
  );
  const list = (await shots.json()) as ShotList;
  const mine = list.shots.find((s) => s.description === "Studio desk close-up");
  assert.ok(mine, "the new shot is in the shot list");
  assert.equal(mine.files.video, null);
  assert.match(mine.files.image, new RegExp(`^media/${id}/\\d{2}-studio-desk-close-up\\.png$`));
});

test("an invalid body is never saved; its errors come back by path", async () => {
  const { id, body } = await createDraft();
  const before = await getScript(id);

  const broken = structuredClone(body);
  broken.sections[0]!.heading = "";
  broken.sections[0]!.sourceIds = ["nope"];
  broken.titleOptions.pop();
  const result = await as(employee, () => saveScript(id, broken));
  assert.equal(result.ok, false);
  const errors = result.ok ? [] : result.errors;
  assert.ok(errors.includes("body.sections[0].heading must not be empty"), errors.join("\n"));
  assert.ok(
    errors.some((e) => e.startsWith('body.sections[0].sourceIds[0] refers to source "nope"')),
  );
  assert.ok(errors.some((e) => e.startsWith("body.titleOptions must have exactly 3 items")));

  // Not even a partial write: body, title and updated_at are untouched.
  const after = await getScript(id);
  assert.deepEqual(after!.body, before!.body);
  assert.equal(after!.updatedAt.getTime(), before!.updatedAt.getTime());
  assert.deepEqual(revalidated, []);
});

test("signed out actions are refused; missing saves return a conflict and unknown statuses throw", async () => {
  const { id, body } = await createDraft();
  await assert.rejects(
    as("", () => saveScript(id, body)),
    /redirect/,
  );
  await assert.rejects(
    as("", () => setStudioScriptStatus(id, "ready")),
    /redirect/,
  );
  const missing = await as(employee, () => saveScript(id + 1000, body));
  assert.equal(missing.ok, false);
  assert.match(missing.ok ? "" : missing.errors.join(" "), /saved script changed/i);
  await assert.rejects(
    as(employee, () => setStudioScriptStatus(id, "scheduled" as schema.ScriptStatus)),
    /Unknown status/,
  );
  assert.equal((await getScript(id))!.status, "draft");
});
