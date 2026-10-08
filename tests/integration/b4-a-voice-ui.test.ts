import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, afterEach, beforeEach, test } from "node:test";
import { eq } from "drizzle-orm";
import { workAsyncStorage } from "next/dist/server/app-render/work-async-storage.external.js";

import { db, schema } from "@/db";
import { GET as consentGet } from "@/app/api/voice/consent/[id]/route";
import { POST as consentPost } from "@/app/api/voice/consent/route";
import { POST as recordingsPost } from "@/app/api/voice/recordings/route";
import {
  createPronunciationAction,
  listTakesAction,
  markWinnerAction,
  previewPronunciationAction,
  reviewPronunciationAction,
  runVoiceTestAction,
  saveVoiceProfileAction,
} from "@/lib/voice.actions";
import { toneWav } from "@/lib/voice/wav";

import { callRoute, signIn } from "./route";
import { resetTables, teardown } from "./setup";

/**
 * Phase A UI paths: the server actions behind /voice, /voice/pronunciations
 * and /voice/test, and the two upload routes, as owner and as employee.
 */

const ffmpeg = spawnSync(process.env.FFMPEG_PATH || "ffmpeg", ["-version"]).status === 0;
const skip = ffmpeg ? false : "ffmpeg is not on PATH (or FFMPEG_PATH): skipping";

let base = "";
let root = "";

beforeEach(async () => {
  process.env.VOICE_FAKE = "1";
  base = mkdtempSync(path.join(tmpdir(), "b4a-ui-"));
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
    new Request("http://localhost/voice", { method: "POST", headers: { cookie } }),
  );
  return value!;
}

function profileForm(fields: Record<string, string | string[]>): FormData {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    for (const value of Array.isArray(v) ? v : [v]) form.append(k, value);
  }
  return form;
}

const tania = {
  key: "tania",
  name: "Tania",
  provider: "azure",
  providerVoiceId: "es-PY-TaniaNeural",
  languages: ["es-PY", "jopara"],
  active: "on",
};

test("profiles: owner creates and edits; employee is refused; Guaraní only for manual", async () => {
  assert.deepEqual(
    await as("employee", () => saveVoiceProfileAction(null, null, profileForm(tania))),
    { ok: false, error: "voice.error.owner" },
  );
  assert.deepEqual(
    await as("owner", () => saveVoiceProfileAction(null, null, profileForm(tania))),
    {
      ok: true,
    },
  );
  const gn = await as("owner", () =>
    saveVoiceProfileAction(null, null, profileForm({ ...tania, key: "x", languages: ["gn"] })),
  );
  assert.equal(gn.ok, false);
  const [row] = await db.select().from(schema.voiceProfiles);
  const edited = await as("owner", () =>
    saveVoiceProfileAction(
      row.id,
      null,
      profileForm({ ...tania, name: "Tania PY", speed: "0.9", azureStyle: "calm" }),
    ),
  );
  assert.deepEqual(edited, { ok: true });
  const [after] = await db.select().from(schema.voiceProfiles);
  assert.equal(after.name, "Tania PY");
  assert.deepEqual(after.settings, { speed: 0.9, azureStyle: "calm" });
});

test(
  "voice gate: renders each ticked voice, one refusal does not stop the others, winner marked",
  { skip },
  async () => {
    await as("owner", () => saveVoiceProfileAction(null, null, profileForm(tania)));
    await as("owner", () =>
      saveVoiceProfileAction(
        null,
        null,
        profileForm({
          ...tania,
          key: "mario",
          name: "Mario",
          providerVoiceId: "es-PY-MarioNeural",
        }),
      ),
    );
    await as("owner", () =>
      saveVoiceProfileAction(
        null,
        null,
        profileForm({
          ...tania,
          key: "ana",
          name: "Ana (clon)",
          provider: "elevenlabs",
          providerVoiceId: "abc",
          consentStatus: "pending",
          consentPerson: "Ana",
        }),
      ),
    );
    const ids = (await db.select().from(schema.voiceProfiles)).map((p) => String(p.id));
    const form = profileForm({
      text: "Che, ¿vos sabés dónde queda Ypacaraí?",
      language: "es-PY",
      profiles: ids,
    });
    const result = await as("owner", () => runVoiceTestAction(null, form));
    assert.ok(result.ok);
    if (!result.ok) return;
    assert.equal(result.outcomes.filter((o) => o.ok).length, 2);
    const refused = result.outcomes.find((o) => !o.ok);
    assert.ok(refused && !refused.ok && refused.error === "voice.error.refused");

    const takes = await db.select().from(schema.narrations);
    assert.equal(takes.length, 2);
    assert.ok(takes.every((t) => t.ownerKind === "voice_test" && t.ownerRef === result.ownerRef));

    assert.deepEqual(await as("owner", () => markWinnerAction(takes[1].id, "más cálida")), {
      ok: true,
    });
    assert.deepEqual(await as("owner", () => markWinnerAction(takes[0].id, "")), { ok: true });
    const after = await db.select().from(schema.narrations).orderBy(schema.narrations.id);
    assert.deepEqual(
      after.map((t) => t.selected),
      [true, false],
    );
    assert.equal(after[1].reviewNote, "más cálida");
    assert.equal(after[0].reviewStatus, "approved");

    const listed = await as("owner", () =>
      listTakesAction({ ownerKind: "voice_test", ownerRef: result.ownerRef, language: "es-PY" }),
    );
    assert.ok(listed.ok && listed.takes.length === 2 && listed.takes[0].id === after[1].id);
  },
);

test(
  "pronunciations: add, review with a name, preview renders with and without",
  { skip },
  async () => {
    await as("owner", () => saveVoiceProfileAction(null, null, profileForm(tania)));
    const [voice] = await db.select().from(schema.voiceProfiles);
    const add = await as("owner", () =>
      createPronunciationAction(
        null,
        profileForm({ term: "Ypacaraí", sayAs: "Ipacaraí", language: "es-PY" }),
      ),
    );
    assert.deepEqual(add, { ok: true });
    const [rule] = await db.select().from(schema.pronunciations);
    assert.equal(rule.reviewStatus, "proposed");

    const preview = await as("owner", () =>
      previewPronunciationAction(rule.id, voice.id, "Vamos a Ypacaraí"),
    );
    assert.ok(preview.ok);
    if (preview.ok) {
      assert.equal(preview.without.text, "Vamos a Ypacaraí");
      assert.equal(preview.with.text, "Vamos a Ipacaraí");
      assert.ok(preview.with.assetId && preview.without.assetId);
    }

    const noName = await as("owner", () => reviewPronunciationAction(rule.id, "approved", " "));
    assert.equal(noName.ok, false);
    assert.deepEqual(
      await as("owner", () => reviewPronunciationAction(rule.id, "approved", "Rosa")),
      {
        ok: true,
      },
    );
    const [approved] = await db.select().from(schema.pronunciations);
    assert.equal(approved.reviewStatus, "approved");
    assert.equal(approved.reviewedBy, "Rosa");
  },
);

test(
  "POST /api/voice/recordings stores an upload as a take; employees are refused",
  { skip },
  async () => {
    const owner = await signIn("owner");
    const employee = await signIn("employee");
    const form = () => {
      const f = new FormData();
      f.set("file", new Blob([new Uint8Array(toneWav({ durationMs: 700 }))]), "rosa.wav");
      f.set("ownerKind", "story_scene");
      f.set("ownerRef", "story:tito");
      f.set("sceneRef", "S01");
      f.set("language", "gn");
      f.set("text", "Tito oiko Ypacaraí ypýpe.");
      return f;
    };
    const req = (cookie: string) =>
      new Request("http://localhost/api/voice/recordings", {
        method: "POST",
        headers: { cookie },
        body: form(),
      });

    assert.equal((await callRoute(recordingsPost, req(employee.cookie))).status, 403);
    const res = await callRoute(recordingsPost, req(owner.cookie));
    assert.equal(res.status, 201, await res.clone().text());
    const body = (await res.json()) as { narrationId: number; playbackPath: string };
    assert.ok(existsSync(path.join(root, body.playbackPath)));
    const [row] = await db
      .select()
      .from(schema.narrations)
      .where(eq(schema.narrations.id, body.narrationId));
    assert.equal(row.provider, "manual");
    assert.equal(row.language, "gn");
  },
);

test("POST /api/voice/consent stores a PDF under voice/_consent and GET serves it", async () => {
  const owner = await signIn("owner");
  await as("owner", () =>
    saveVoiceProfileAction(
      null,
      null,
      profileForm({
        ...tania,
        key: "ana",
        provider: "elevenlabs",
        providerVoiceId: "x",
        consentStatus: "pending",
        consentPerson: "Ana",
      }),
    ),
  );
  const [profile] = await db.select().from(schema.voiceProfiles);
  const upload = (file: Blob) => {
    const f = new FormData();
    f.set("profileId", String(profile.id));
    f.set("file", file, "consent.pdf");
    return new Request("http://localhost/api/voice/consent", {
      method: "POST",
      headers: { cookie: owner.cookie },
      body: f,
    });
  };
  const bad = await callRoute(consentPost, upload(new Blob(["just text"])));
  assert.equal(bad.status, 415);
  const res = await callRoute(consentPost, upload(new Blob(["%PDF-1.4\n% signed consent\n"])));
  assert.equal(res.status, 201);
  const { path: rel } = (await res.json()) as { path: string };
  assert.match(rel, /^voice\/_consent\/ana-\d{8}T\d{6}\.pdf$/);
  assert.ok(existsSync(path.join(root, rel)));

  const get = await callRoute(
    (r) => consentGet(r, { params: Promise.resolve({ id: String(profile.id) }) }),
    new Request(`http://localhost/api/voice/consent/${profile.id}`, {
      headers: { cookie: owner.cookie },
    }),
  );
  assert.equal(get.status, 200);
  assert.equal(get.headers.get("content-type"), "application/pdf");
});
