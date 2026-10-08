import { insertReturning } from "@/db/mutations";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, afterEach, beforeEach, test } from "node:test";
import { asc } from "drizzle-orm";

import { db, schema } from "@/db";
import { POST as uploadPost } from "@/app/voice/record/upload/route";
import { sampleScriptBody } from "@/lib/scripts/fixture";
import { loadRecordSession, recordingMinutes } from "@/lib/voice/record/session";
import { toneWav } from "@/lib/voice/wav";

import { callRoute, signIn } from "./route";
import { resetTables, teardown } from "./setup";

/**
 * Phase B (build 5 §3.B): a generated WAV posted through the recording
 * studio's upload route becomes a manual take with the line's exact text, on
 * the stories studio's slot; locked lines, changed text and missing consent
 * are refused; progress and resume follow.
 */

const ffmpeg = spawnSync(process.env.FFMPEG_PATH || "ffmpeg", ["-version"]).status === 0;
const skip = ffmpeg ? false : "ffmpeg is not on PATH (or FFMPEG_PATH): skipping";

const HOLA = "—¡Hola, Meli!\n—dijo Tito.";

let base = "";
let narratorId = 0;
let pendingId = 0;
let scriptId = 0;

beforeEach(async () => {
  base = mkdtempSync(path.join(tmpdir(), "b5b-"));
  const media = path.join(base, "drive");
  mkdirSync(media);
  process.env.MEDIA_ROOT = media;
  process.env.CUENTOS_ROOT = path.join(base, "cuentos");
  await resetTables();

  const [story] = await insertReturning(
    db,
    schema.stories,
    {
      slug: "tito",
      title: "Tito salta",
      sourcePath: "books/tito",
      languages: ["es", "gn"],
    },
    { id: schema.stories.id },
  );
  await db.insert(schema.storyScenes).values([
    {
      storyId: story.id,
      sceneRef: "S01",
      position: 1,
      text: { es: "Tito salta.", gn: "Tito opopo." },
      textStatus: { es: "approved", gn: "human-review-pending" },
    },
    {
      storyId: story.id,
      sceneRef: "S02",
      position: 2,
      text: { es: `${HOLA} Meli sonrió.`, gn: "Tito he'i." },
      textStatus: { es: "approved", gn: "approved" },
      lines: {
        es: [
          { speaker: "tito", text: HOLA },
          { speaker: null, text: "Meli sonrió." },
        ],
      },
    },
  ]);

  const [narrator] = await insertReturning(
    db,
    schema.voiceProfiles,
    {
      key: "rosa",
      name: "Rosa",
      provider: "manual",
      languages: ["es-PY", "gn"],
      consentStatus: "signed",
      consentPerson: "Rosa",
    },
    { id: schema.voiceProfiles.id },
  );
  const [pending] = await insertReturning(
    db,
    schema.voiceProfiles,
    {
      key: "ana",
      name: "Ana",
      provider: "manual",
      languages: ["es-PY"],
      consentStatus: "pending",
    },
    { id: schema.voiceProfiles.id },
  );
  narratorId = narrator.id;
  pendingId = pending.id;

  const body = sampleScriptBody();
  const [script] = await insertReturning(
    db,
    schema.scripts,
    { brandId: "guide", title: body.chosenTitle, language: "es-PY", body },
    { id: schema.scripts.id },
  );
  scriptId = script.id;
});

afterEach(() => rmSync(base, { recursive: true, force: true }));

after(async () => {
  delete process.env.MEDIA_ROOT;
  delete process.env.CUENTOS_ROOT;
  await teardown();
});

function upload(cookie: string, fields: Record<string, string>): Request {
  const form = new FormData();
  form.set("file", new Blob([new Uint8Array(toneWav({ durationMs: 900 }))]), "take.wav");
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  return new Request("http://localhost/voice/record/upload", {
    method: "POST",
    headers: { cookie },
    body: form,
  });
}

test(
  "a posted WAV becomes a manual take with the exact line text on the stories slot",
  { skip },
  async () => {
    const owner = await signIn("owner");
    const employee = await signIn("employee");
    const fields = {
      source: "story:tito:es",
      slot: "S02#1",
      voiceProfileId: String(narratorId),
      text: HOLA,
      autoSelect: "1",
    };
    assert.equal((await callRoute(uploadPost, upload(employee.cookie, fields))).status, 403);

    const res = await callRoute(uploadPost, upload(owner.cookie, fields));
    const body = (await res.json()) as { narrationId: number; selected: boolean };
    assert.equal(res.status, 201, JSON.stringify(body));
    assert.equal(body.selected, true);

    const [row] = await db.select().from(schema.narrations);
    assert.equal(row.id, body.narrationId);
    assert.equal(row.provider, "manual");
    assert.equal(row.status, "done");
    assert.equal(row.ownerKind, "story_scene");
    assert.equal(row.ownerRef, "story:tito");
    assert.equal(row.sceneRef, "S02#1");
    assert.equal(row.language, "es-PY");
    assert.equal(row.speaker, "tito");
    assert.equal(row.voiceProfileId, narratorId);
    assert.equal(row.inputText, HOLA, "exact text, line break included");
    assert.equal(row.selected, true);
    assert.ok((row.durationMs ?? 0) > 800);

    // A second keep of the same line is kept too, but does not steal the selection.
    const again = await callRoute(uploadPost, upload(owner.cookie, fields));
    assert.equal(again.status, 201);
    assert.equal(((await again.json()) as { selected: boolean }).selected, false);

    // Progress: S01 and S02#2 remain; resume at S01 (index 0), minutes counted.
    const [profile] = await db
      .select()
      .from(schema.voiceProfiles)
      .orderBy(asc(schema.voiceProfiles.id));
    const session = await loadRecordSession(
      { kind: "story", slug: "tito", lang: "es" },
      "story:tito:es",
      profile,
    );
    assert.ok(session);
    assert.equal(session.refusal, null);
    assert.deepEqual(
      session.lines.map((l) => [l.slot, l.takeCount]),
      [
        ["S01", 0],
        ["S02#1", 2],
        ["S02#2", 0],
      ],
    );
    assert.equal(session.progress.recorded, 1);
    assert.equal(session.progress.total, 3);
    assert.equal(session.progress.resumeIndex, 0);
    const minutes = await recordingMinutes();
    assert.equal(minutes.length, 1);
    assert.equal(minutes[0].language, "es-PY");
    assert.equal(minutes[0].takes, 2);
  },
);

test(
  "refusals: locked Guaraní line, changed text, consent missing, unknown line",
  { skip },
  async () => {
    const owner = await signIn("owner");
    const post = async (fields: Record<string, string>) => {
      const res = await callRoute(uploadPost, upload(owner.cookie, fields));
      return { status: res.status, body: (await res.json()) as { error: string; reason?: string } };
    };
    const locked = await post({
      source: "story:tito:gn",
      slot: "S01",
      voiceProfileId: String(narratorId),
      text: "Tito opopo.",
    });
    assert.equal(locked.status, 422);
    assert.equal(locked.body.reason, "locked");
    assert.match(locked.body.error, /human-review-pending/);

    const gn = await post({
      source: "story:tito:gn",
      slot: "S02",
      voiceProfileId: String(narratorId),
      text: "Tito he'i.",
    });
    assert.equal(gn.status, 201, "approved Guaraní is recorded by a person");

    const changed = await post({
      source: "story:tito:es",
      slot: "S01",
      voiceProfileId: String(narratorId),
      text: "Tito saltó.",
    });
    assert.equal(changed.body.reason, "text_changed");

    const consent = await post({
      source: "story:tito:es",
      slot: "S01",
      voiceProfileId: String(pendingId),
      text: "Tito salta.",
    });
    assert.equal(consent.status, 422);
    assert.equal(consent.body.reason, "consent_missing");

    const unknown = await post({
      source: "story:tito:es",
      slot: "S09",
      voiceProfileId: String(narratorId),
      text: "x",
    });
    assert.equal(unknown.status, 404);

    const rows = await db.select().from(schema.narrations);
    assert.equal(rows.length, 1, "only the approved Guaraní take was written");
    assert.equal(rows[0].language, "gn");
  },
);

test(
  "script source: a block becomes a take with the video studio's convention",
  { skip },
  async () => {
    const owner = await signIn("owner");
    const res = await callRoute(
      uploadPost,
      upload(owner.cookie, {
        source: `script:${scriptId}`,
        slot: "hook",
        voiceProfileId: String(narratorId),
        text: "Everyone still says ninety days. That changed.",
        autoSelect: "1",
      }),
    );
    assert.equal(res.status, 201, await res.clone().text());
    const [row] = await db.select().from(schema.narrations);
    assert.equal(row.ownerKind, "script");
    assert.equal(row.ownerRef, `script:${scriptId}`);
    assert.equal(row.sceneRef, "hook");
    assert.equal(row.language, "es-PY");
    assert.equal(row.speaker, null);
    assert.equal(row.inputText, "Everyone still says ninety days. That changed.");
    assert.equal(row.selected, true);
  },
);
