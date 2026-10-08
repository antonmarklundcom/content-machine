import { insertReturning } from "@/db/mutations";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, afterEach, beforeEach, test } from "node:test";
import { eq, sql } from "drizzle-orm";

import { db, schema } from "@/db";
import { GET, POST } from "@/app/api/voice/reference/[profileId]/route";
import type { VoiceSettings } from "@/lib/voice/contract";
import { chatterboxAdapter } from "@/lib/voice/providers/chatterbox";
import { parseWav, toneWav } from "@/lib/voice/wav";

import { callRoute, signIn } from "./route";
import { resetTables, teardown } from "./setup";

/**
 * Phase D: the Chatterbox reference upload route — owner-only, consent-gated,
 * normalised to WAV 24 kHz mono ≤ 30 s, path merged into the profile's
 * settings without clobbering other keys — and the adapter reading it back.
 */

const ffmpeg = spawnSync(process.env.FFMPEG_PATH || "ffmpeg", ["-version"]).status === 0;
const skip = ffmpeg ? false : "ffmpeg is not on PATH (or FFMPEG_PATH): skipping";

let base = "";
let root = "";

beforeEach(async () => {
  base = mkdtempSync(path.join(tmpdir(), "b5d-"));
  root = path.join(base, "drive");
  mkdirSync(root);
  process.env.MEDIA_ROOT = root;
  await resetTables();
});

afterEach(() => rmSync(base, { recursive: true, force: true }));

after(async () => {
  delete process.env.MEDIA_ROOT;
  await teardown();
});

async function profile(
  consentStatus: "not_needed" | "pending" | "signed" | "revoked",
  settings: VoiceSettings,
) {
  const [row] = await insertReturning(db, schema.voiceProfiles, {
    key: "ana-clon",
    name: "Ana (clon)",
    provider: "chatterbox",
    providerVoiceId: "ana",
    languages: ["es-PY"],
    settings,
    consentStatus,
    consentPerson: consentStatus === "not_needed" ? null : "Ana",
  });
  return row;
}

const ctx = (id: number | string) => ({ params: Promise.resolve({ profileId: String(id) }) });

function upload(id: number, cookie: string, file: Blob, name = "sample.wav"): Request {
  const f = new FormData();
  f.set("file", file, name);
  return new Request(`http://localhost/api/voice/reference/${id}`, {
    method: "POST",
    headers: { cookie },
    body: f,
  });
}

const wavBlob = (ms: number, sampleRate = 44_100) =>
  new Blob([new Uint8Array(toneWav({ durationMs: ms, sampleRate }))], { type: "audio/wav" });

test(
  "upload: normalised to 24 kHz mono ≤ 30 s, settings merged, GET streams it",
  { skip },
  async () => {
    const owner = await signIn("owner");
    const employee = await signIn("employee");
    const p = await profile("signed", {
      model: "keep-me",
      speed: 0.9,
      chatterbox: { mode: "replicate", exaggeration: 0.8 },
    });

    const forbidden = await callRoute(
      (r) => POST(r, ctx(p.id)),
      upload(p.id, employee.cookie, wavBlob(10_000)),
    );
    assert.equal(forbidden.status, 403);

    const res = await callRoute(
      (r) => POST(r, ctx(p.id)),
      upload(p.id, owner.cookie, wavBlob(35_000)),
    );
    assert.equal(res.status, 201, await res.clone().text());
    const { path: rel, durationMs } = (await res.json()) as { path: string; durationMs: number };
    assert.match(rel, /^voice\/_references\/ana-clon-\d{8}T\d{9}\.wav$/);
    assert.ok(durationMs <= 30_000 && durationMs >= 29_000, String(durationMs));
    const info = parseWav(readFileSync(path.join(root, rel)));
    assert.equal(info?.sampleRate, 24_000);
    assert.equal(info?.channels, 1);

    const [row] = await db
      .select()
      .from(schema.voiceProfiles)
      .where(eq(schema.voiceProfiles.id, p.id));
    assert.deepEqual(row.settings, {
      model: "keep-me",
      speed: 0.9,
      chatterbox: { mode: "replicate", exaggeration: 0.8, referencePath: rel },
    });

    const get = await callRoute(
      (r) => GET(r, ctx(p.id)),
      new Request(`http://localhost/api/voice/reference/${p.id}`, {
        headers: { cookie: owner.cookie },
      }),
    );
    assert.equal(get.status, 200);
    assert.equal(get.headers.get("content-type"), "audio/wav");

    // The adapter reads the stored sample from MEDIA_ROOT.
    const sent: string[] = [];
    await chatterboxAdapter(
      {},
      {
        fetch: async (_url, init) => {
          sent.push(JSON.parse(String(init?.body)).reference_wav_base64);
          return new Response(new Uint8Array(toneWav({ durationMs: 300 })));
        },
      },
    ).synthesize(
      "Hola che.",
      { ...row, settings: { chatterbox: { mode: "local", referencePath: rel } } },
      {
        language: "es-PY",
      },
    );
    assert.equal(sent[0], readFileSync(path.join(root, rel)).toString("base64"));
  },
);

test("upload: a profile without its own settings gets mode local", { skip }, async () => {
  const owner = await signIn("owner");
  const p = await profile("not_needed", {});
  const res = await callRoute(
    (r) => POST(r, ctx(p.id)),
    upload(p.id, owner.cookie, wavBlob(8_000)),
  );
  assert.equal(res.status, 201);
  const { path: rel } = (await res.json()) as { path: string };
  const [row] = await db
    .select()
    .from(schema.voiceProfiles)
    .where(eq(schema.voiceProfiles.id, p.id));
  assert.deepEqual(row.settings, { chatterbox: { mode: "local", referencePath: rel } });

  // Legacy partial JSON can have Chatterbox options without an explicit mode.
  await db
    .update(schema.voiceProfiles)
    .set({
      settings: sql`json_object('model', 'keep-me', 'chatterbox', json_object('exaggeration', 0.8, 'cfgWeight', 0))`,
    })
    .where(eq(schema.voiceProfiles.id, p.id));
  const again = await callRoute(
    (r) => POST(r, ctx(p.id)),
    upload(p.id, owner.cookie, wavBlob(8_000)),
  );
  assert.equal(again.status, 201, await again.clone().text());
  const { path: nextPath } = (await again.json()) as { path: string };
  const [updated] = await db
    .select()
    .from(schema.voiceProfiles)
    .where(eq(schema.voiceProfiles.id, p.id));
  assert.deepEqual(updated.settings, {
    model: "keep-me",
    chatterbox: { mode: "local", exaggeration: 0.8, cfgWeight: 0, referencePath: nextPath },
  });
  assert.ok(existsSync(path.join(root, rel)), "the previous reference sample is preserved");
});

test("upload refusals: consent, not audio, too short, too big, unknown profile", async () => {
  const owner = await signIn("owner");
  const pending = await profile("pending", {});
  const refused = await callRoute(
    (r) => POST(r, ctx(pending.id)),
    upload(pending.id, owner.cookie, wavBlob(10_000)),
  );
  assert.equal(refused.status, 422);
  assert.equal(((await refused.json()) as { reason: string }).reason, "consent_missing");
  assert.ok(!existsSync(path.join(root, "voice", "_references")));
  const [row] = await db.select().from(schema.voiceProfiles);
  assert.deepEqual(row.settings, {});

  await db
    .update(schema.voiceProfiles)
    .set({ consentStatus: "signed" })
    .where(eq(schema.voiceProfiles.id, pending.id));

  const missing = await callRoute(
    (r) => POST(r, ctx(9999)),
    upload(9999, owner.cookie, wavBlob(10)),
  );
  assert.equal(missing.status, 404);

  const big = await callRoute(
    (r) => POST(r, ctx(pending.id)),
    upload(pending.id, owner.cookie, new Blob([new Uint8Array(20 * 1024 * 1024 + 1)])),
  );
  assert.equal(big.status, 413);

  if (!ffmpeg) return;
  const notAudio = await callRoute(
    (r) => POST(r, ctx(pending.id)),
    upload(pending.id, owner.cookie, new Blob(["just some text"]), "notes.txt"),
  );
  assert.equal(notAudio.status, 415);
  const short = await callRoute(
    (r) => POST(r, ctx(pending.id)),
    upload(pending.id, owner.cookie, wavBlob(1_000)),
  );
  assert.equal(short.status, 400);
  assert.match(((await short.json()) as { error: string }).error, /at least 3 s/);

  const none = await callRoute(
    (r) => GET(r, ctx(pending.id)),
    new Request(`http://localhost/api/voice/reference/${pending.id}`, {
      headers: { cookie: owner.cookie },
    }),
  );
  assert.equal(none.status, 404);
});
