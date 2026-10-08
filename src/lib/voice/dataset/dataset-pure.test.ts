import assert from "node:assert/strict";
import { test } from "node:test";

import { cleanField, metadataCsv, metadataLine } from "./csv";
import { normalizeText, spellNumberEs } from "./normalize";
import {
  assertExportConsent,
  DatasetConsentError,
  selectClips,
  type DatasetCandidate,
} from "./select";

let nextId = 1;
function take(over: Partial<DatasetCandidate> = {}): DatasetCandidate {
  const id = over.id ?? nextId++;
  return {
    id,
    ownerKind: "story_scene",
    ownerRef: "story:tito",
    sceneRef: "S01",
    speaker: null,
    provider: "manual",
    status: "done",
    reviewStatus: "approved",
    selected: false,
    durationMs: 3000,
    inputText: "Tito vivía cerca del lago.",
    createdAt: new Date(2026, 9, 1, 10, 0, id),
    masterPath: `voice/x/take-${id}.wav`,
    ...over,
  };
}

test("one take per slot: the selected one, else the newest approved", () => {
  const a = take({ id: 10 });
  const b = take({ id: 11, selected: true });
  const c = take({ id: 12 });
  const d = take({ id: 20, sceneRef: "S02" });
  const e = take({ id: 21, sceneRef: "S02" });
  const f = take({ id: 22, sceneRef: "S02", speaker: "tito" });
  const sel = selectClips([a, b, c, d, e, f]);
  assert.deepEqual(
    sel.clips.map((x) => x.id),
    [11, 21, 22],
  );
});

test("approved manual only by default; rejected, failed, TTS and unreviewed left out", () => {
  const rows = [
    take({ id: 30, sceneRef: "A", reviewStatus: "unreviewed" }),
    take({ id: 31, sceneRef: "B", reviewStatus: "rejected" }),
    take({ id: 32, sceneRef: "C", status: "failed" }),
    take({ id: 33, sceneRef: "D", provider: "azure" }),
    take({ id: 34, sceneRef: "E" }),
  ];
  assert.deepEqual(
    selectClips(rows).clips.map((x) => x.id),
    [34],
  );
  assert.deepEqual(
    selectClips(rows, { includeUnreviewed: true }).clips.map((x) => x.id),
    [30, 34],
  );
  assert.deepEqual(
    selectClips(rows, { includeTts: true }).clips.map((x) => x.id),
    [33, 34],
  );
});

test("a selected but rejected take falls back to the newest approved", () => {
  const sel = selectClips([
    take({ id: 40, selected: true, reviewStatus: "rejected" }),
    take({ id: 41 }),
  ]);
  assert.deepEqual(
    sel.clips.map((x) => x.id),
    [41],
  );
});

test("duration filter (default 1–15 s, configurable) is reported", () => {
  const rows = [
    take({ id: 50, sceneRef: "A", durationMs: 800 }),
    take({ id: 51, sceneRef: "B", durationMs: 16_000 }),
    take({ id: 52, sceneRef: "C", durationMs: 5000 }),
    take({ id: 53, sceneRef: "D", masterPath: null }),
    take({ id: 54, sceneRef: "E", durationMs: null }),
  ];
  const sel = selectClips(rows);
  assert.deepEqual(
    sel.clips.map((x) => x.id),
    [52],
  );
  assert.deepEqual(
    sel.excluded.map((x) => [x.id, x.reason]),
    [
      [50, "too_short"],
      [51, "too_long"],
      [53, "no_audio"],
      [54, "no_duration"],
    ],
  );
  assert.deepEqual(
    selectClips(rows, { minSec: 0.5, maxSec: 20 }).clips.map((x) => x.id),
    [50, 51, 52],
  );
  assert.throws(() => selectClips(rows, { minSec: 5, maxSec: 2 }));
});

test("consent: pending and revoked refuse; signed and not_needed pass", () => {
  assert.throws(
    () => assertExportConsent({ name: "Ana", consentStatus: "pending" }),
    DatasetConsentError,
  );
  assert.throws(
    () => assertExportConsent({ name: "Ana", consentStatus: "revoked" }),
    DatasetConsentError,
  );
  assertExportConsent({ name: "Ana", consentStatus: "signed" });
  assertExportConsent({ name: "Anton", consentStatus: "not_needed" });
});

test("CSV: pipes and line breaks are made safe, Guaraní letters and the puso kept", () => {
  assert.equal(cleanField("uno|dos\r\ntres\n\ncuatro\t cinco "), "uno / dos tres cuatro cinco");
  const gn = "Che ra'y, ãga ẽ ĩ õ ũ ỹ g̃uahẽ";
  assert.equal(cleanField(gn), gn.normalize("NFC"));
  assert.ok(cleanField(gn).includes("g̃"));
  assert.equal(
    metadataLine({ id: "take1", text: "a|b\nc", normalized: "a|b\nc" }),
    "take1|a / b c|a / b c",
  );
  const csv = metadataCsv([
    { id: "take1", text: gn, normalized: gn },
    { id: "take2", text: "Hola", normalized: "Hola" },
  ]);
  const lines = csv.split("\n");
  assert.equal(lines.length, 3);
  assert.equal(lines[2], "");
  for (const l of lines.slice(0, 2)) assert.equal(l.split("|").length, 3);
  assert.equal(metadataCsv([]), "");
});

test("Spanish number words", () => {
  assert.equal(spellNumberEs(0), "cero");
  assert.equal(spellNumberEs(16), "dieciséis");
  assert.equal(spellNumberEs(21), "veintiuno");
  assert.equal(spellNumberEs(45), "cuarenta y cinco");
  assert.equal(spellNumberEs(100), "cien");
  assert.equal(spellNumberEs(101), "ciento uno");
  assert.equal(spellNumberEs(500), "quinientos");
  assert.equal(spellNumberEs(1000), "mil");
  assert.equal(spellNumberEs(1500), "mil quinientos");
  assert.equal(spellNumberEs(21_000), "veintiún mil");
  assert.equal(spellNumberEs(2026), "dos mil veintiséis");
  assert.equal(spellNumberEs(1_000_000), "un millón");
  assert.equal(spellNumberEs(3_200_000), "tres millones doscientos mil");
});

test("normalizeText spells numbers for Spanish only", () => {
  assert.equal(
    normalizeText("Tengo 3 perros y 1.500 gallinas.", "es-PY"),
    "Tengo tres perros y mil quinientos gallinas.",
  );
  assert.equal(normalizeText("Pesa 3,5 kilos", "es"), "Pesa tres coma cinco kilos");
  assert.equal(normalizeText("Mbohapy 3", "gn"), "Mbohapy 3");
  assert.equal(normalizeText("I have 3", "en"), "I have 3");
});
