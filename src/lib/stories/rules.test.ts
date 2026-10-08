import assert from "node:assert/strict";
import { test } from "node:test";

import { mergeSceneStatus, textSha } from "./meta";
import {
  canApproveInApp,
  canNarrate,
  findPendingNotice,
  isBedtimeAge,
  lineSlot,
  narrationLines,
  scenePadMs,
  ttsAllowed,
  voiceLanguageFor,
} from "./rules";

const scene = (text: Record<string, string | null>, textStatus: Record<string, string>) => ({
  sceneRef: "S01",
  text,
  textStatus,
});

test("approved statuses narrate; pending, unknown and odd spellings are handled", () => {
  for (const s of [
    "approved",
    "Final",
    "reviewed",
    "LOCKED",
    "approved-in-app",
    "approved_in_app",
  ]) {
    assert.equal(canNarrate(scene({ es: "Hola, vos." }, { es: s }), "es").ok, true, s);
  }
  const pending = canNarrate(scene({ es: "Hola." }, { es: "pending-review" }), "es");
  assert.deepEqual(pending.ok ? null : pending.reason, "not_approved");
  const unknown = canNarrate(scene({ es: "Hola." }, {}), "es");
  assert.deepEqual(unknown.ok ? null : unknown.reason, "status_unknown");
});

test("a missing language is a refusal, never a fallback", () => {
  const s = scene({ es: "Tito saltó.", gn: null }, { es: "approved", gn: "approved" });
  const gn = canNarrate(s, "gn");
  assert.equal(gn.ok, false);
  assert.equal(gn.ok ? null : gn.reason, "missing_text");
  const jopara = canNarrate(s, "jopara");
  assert.equal(jopara.ok ? null : jopara.reason, "missing_text");
});

test("pending-review notices always refuse, even when the status says approved", () => {
  for (const text of [
    "Fue un salto. PENDIENTE: revisar",
    "[??] Ha'e peteĩ jopo.",
    "Texto (pending review)",
    "TODO: final",
    "REVISAR esta línea",
  ]) {
    const r = canNarrate(scene({ es: text }, { es: "approved" }), "es");
    assert.equal(r.ok ? null : r.reason, "pending_notice", text);
  }
  // Ordinary Spanish words are not notices.
  assert.equal(findPendingNotice("Todo el día, la pendiente, vamos a revisar el nido."), null);
});

test("a notice inside a split line refuses too", () => {
  const r = canNarrate(
    {
      ...scene({ es: "Hola. Chau." }, { es: "approved" }),
      lines: { es: [{ speaker: null, text: "Hola. [??]" }] },
    },
    "es",
  );
  assert.equal(r.ok ? null : r.reason, "pending_notice");
});

test("in-app approval: allowed for unapproved text, never for missing text or a notice", () => {
  assert.equal(canApproveInApp(scene({ es: "Hola." }, { es: "draft" }), "es").ok, true);
  assert.equal(canApproveInApp(scene({ es: "Hola." }, {}), "es").ok, true);
  assert.equal(canApproveInApp(scene({ gn: null }, {}), "gn").ok, false);
  assert.equal(canApproveInApp(scene({ es: "PENDIENTE" }, { es: "draft" }), "es").ok, false);
});

test("languages: es is castellano paraguayo; gn is upload-only", () => {
  assert.equal(voiceLanguageFor("es"), "es-PY");
  assert.equal(voiceLanguageFor("gn"), "gn");
  assert.equal(voiceLanguageFor("jopara"), "jopara");
  assert.equal(voiceLanguageFor("xx"), null);
  assert.equal(ttsAllowed("gn"), false);
  assert.equal(ttsAllowed("es"), true);
  assert.equal(ttsAllowed("jopara"), true);
});

test("line slots and narration lines", () => {
  assert.equal(lineSlot("S03", 0, 1), "S03");
  assert.equal(lineSlot("S03", 1, 3), "S03#2");
  assert.deepEqual(narrationLines(scene({ es: "Hola." }, {}), "es"), [
    { speaker: null, text: "Hola." },
  ]);
  assert.deepEqual(narrationLines(scene({ gn: null }, {}), "gn"), []);
});

test("bedtime pacing for baby and preschool age bands", () => {
  assert.equal(isBedtimeAge("3-5"), true);
  assert.equal(isBedtimeAge("0-3"), true);
  assert.equal(isBedtimeAge("baby"), true);
  assert.equal(isBedtimeAge("preescolar"), true);
  assert.equal(isBedtimeAge("6-9"), false);
  assert.equal(isBedtimeAge("12+"), false);
  assert.equal(isBedtimeAge(null), false);
  assert.equal(scenePadMs("3-5"), 900);
  assert.equal(scenePadMs("8-12"), 600);
});

test("re-import keeps an in-app approval only while the repo status and the text are unchanged", () => {
  const text = "Tito saltó.";
  const approvals = {
    es: {
      by: "anton@example.com",
      at: "2026-10-07T00:00:00Z",
      repoStatus: "pending-review",
      textSha: textSha(text),
    },
  };
  const kept = mergeSceneStatus(
    { sceneRef: "S03", text: { es: text }, textStatus: { es: "pending-review" } },
    { approvals },
  );
  assert.equal(kept.textStatus.es, "approved-in-app");
  assert.deepEqual(kept.kept, ["S03 es"]);

  const statusMoved = mergeSceneStatus(
    { sceneRef: "S03", text: { es: text }, textStatus: { es: "draft" } },
    { approvals },
  );
  assert.equal(statusMoved.textStatus.es, "draft");
  assert.equal(statusMoved.meta.approvals?.es, undefined);
  assert.match(statusMoved.dropped[0], /repo status changed/);

  const textMoved = mergeSceneStatus(
    { sceneRef: "S03", text: { es: "Tito saltó alto." }, textStatus: { es: "pending-review" } },
    { approvals },
  );
  assert.equal(textMoved.textStatus.es, "pending-review");
  assert.match(textMoved.dropped[0], /text changed/);
});
