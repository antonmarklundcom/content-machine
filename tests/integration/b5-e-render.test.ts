import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, afterEach, beforeEach, test } from "node:test";
import { eq } from "drizzle-orm";
import { workAsyncStorage } from "next/dist/server/app-render/work-async-storage.external.js";

import { db, schema } from "@/db";
import { renderStoryAction } from "@/lib/stories.actions";
import { approveSceneText, narrateScene } from "@/lib/stories/studio";
import { listMusicAction, startRenderAction } from "@/lib/video.actions";
import type { RenderPlan } from "@/lib/video/render";

import { fakeEngines, makeCuentosRoot, SLUG } from "./b4-c-fakes";
import { callRoute, signIn } from "./route";
import { resetTables, teardown } from "./setup";

/**
 * Phase E (build 5): the story render action queues (returns a render id at
 * once, the row reaches done in the background) and passes the music bed and
 * its level through to the RenderRequest.
 */

const FFMPEG_BIN = process.env.FFMPEG_PATH || "ffmpeg";
const ffmpeg =
  spawnSync(FFMPEG_BIN, ["-version"]).status === 0 &&
  spawnSync(process.env.FFPROBE_PATH || "ffprobe", ["-version"]).status === 0;
const skip = ffmpeg ? false : "ffmpeg/ffprobe not on PATH: skipping";

let cuentos = "";
let media = "";

beforeEach(async () => {
  await resetTables();
  cuentos = await makeCuentosRoot();
  media = mkdtempSync(path.join(tmpdir(), "media-b5e-"));
  process.env.CUENTOS_ROOT = cuentos;
  process.env.MEDIA_ROOT = media;
  const { importStories } = await import("@/lib/stories/import");
  await importStories();
  await db.insert(schema.voiceProfiles).values([
    {
      key: "narradora-py",
      name: "Narradora PY",
      provider: "elevenlabs",
      languages: ["es-PY"],
      role: "narrator",
    },
    {
      key: "tito",
      name: "Tito",
      provider: "elevenlabs",
      languages: ["es-PY"],
      role: "character",
      characterKey: "tito",
    },
  ]);
});

afterEach(() => {
  rmSync(cuentos, { recursive: true, force: true });
  rmSync(media, { recursive: true, force: true });
  delete process.env.CUENTOS_ROOT;
  delete process.env.MEDIA_ROOT;
});

after(teardown);

async function as<T>(role: "owner" | "employee", run: () => Promise<T>): Promise<T> {
  const { cookie } = await signIn(role, `${role}-${Math.random()}@example.com`);
  let value: T;
  await callRoute(
    async () => {
      const store = workAsyncStorage.getStore() as unknown as Record<string, unknown>;
      store.incrementalCache ??= {};
      value = await run();
      return new Response(null, { status: 204 });
    },
    new Request(`http://localhost/stories/${SLUG}`, { method: "POST", headers: { cookie } }),
  );
  return value!;
}

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

async function waitForRow(id: number, timeoutMs = 120_000) {
  const start = Date.now();
  for (;;) {
    const [row] = await db.select().from(schema.videoRenders).where(eq(schema.videoRenders.id, id));
    if (row && (row.status === "done" || row.status === "failed")) return row;
    if (Date.now() - start > timeoutMs) throw new Error(`render ${id} still ${row?.status}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

test("story render is queued, carries the music bed, and reaches done", { skip }, async () => {
  const { deps } = fakeEngines();
  await approveSceneText(SLUG, "S03", "es", "anton@example.com");
  for (const s of ["S01", "S02", "S03"])
    await narrateScene({ slug: SLUG, sceneRef: s, lang: "es" }, deps);

  mkdirSync(path.join(media, "music"), { recursive: true });
  const bed = path.join(media, "music", "bed.wav");
  spawnSync(FFMPEG_BIN, ["-v", "error", "-f", "lavfi", "-i", "sine=frequency=220:duration=3", bed]);

  const tracks = await as("owner", () => listMusicAction());
  assert.deepEqual(
    tracks.map((t) => t.path),
    ["music/bed.wav"],
  );
  assert.deepEqual(await as("employee", () => listMusicAction()), []);

  // A path that climbs out is refused before anything is queued.
  const bad = await as("owner", () =>
    renderStoryAction(
      SLUG,
      null,
      form({ lang: "es", format: "16x9", mode: "sample", music: "../bed.wav" }),
    ),
  );
  assert.equal(bad.ok, false);
  const badScript = await as("owner", () =>
    startRenderAction({
      ownerKind: "script",
      ownerRef: "script:1",
      language: "es-PY",
      format: "16x9",
      musicPath: "/etc/passwd.mp3",
    }),
  );
  assert.equal(badScript.ok, false);
  assert.match(!badScript.ok ? badScript.error : "", /Not a music file/);
  assert.equal((await db.select().from(schema.videoRenders)).length, 0);

  const startedAt = Date.now();
  let statusAtReturn = "";
  const result = await as("owner", async () => {
    const r = await renderStoryAction(
      SLUG,
      null,
      form({ lang: "es", format: "16x9", mode: "sample", music: "music/bed.wav", musicDb: "-21" }),
    );
    const [row] = await db.select().from(schema.videoRenders);
    statusAtReturn = row?.status ?? "";
    return r;
  });
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(result.message, "stories.render.queued");
  const id = Number(result.vars?.id);
  assert.ok(id > 0);
  assert.ok(["queued", "rendering"].includes(statusAtReturn), `returned while ${statusAtReturn}`);
  assert.ok(Date.now() - startedAt < 30_000);

  const row = await waitForRow(id);
  assert.equal(row.status, "done", row.error ?? "");
  const req = (row.plan as RenderPlan).request;
  assert.equal(req.musicPath, bed);
  assert.equal(req.musicDb, -21);
  assert.equal(req.ownerKind, "story");
});
