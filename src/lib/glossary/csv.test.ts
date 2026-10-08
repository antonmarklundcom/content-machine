import assert from "node:assert/strict";
import { test } from "node:test";

import { glossaryToCsv, GlossaryCsvError, parseCsv, parseGlossaryCsv, toCsv } from "./csv";

test("RFC 4180: quotes, doubled quotes, commas and newlines round-trip", () => {
  const records = [
    ["a", 'say "hi"', "x,y"],
    ["line\nbreak", "", "ñandú"],
  ];
  const text = toCsv(records);
  assert.match(text, /"say ""hi"""/);
  assert.deepEqual(parseCsv(text), records);
});

test("Guaraní letters and the puso survive a round-trip; BOM is ignored", () => {
  const row = {
    term: "mba'e",
    language: "gn",
    meaningEs: "cosa, qué",
    meaningEn: null,
    sayAs: "mbaé",
    partOfSpeech: "noun",
    register: "everyday" as const,
    joparaOk: true,
    example: "Mba'e piko ko'ãga? g̃ ỹ ã ẽ ĩ õ ũ",
    exampleTranslation: 'What "now"?',
    reviewStatus: "approved" as const,
    reviewedBy: "Ña Rosa",
    reviewedAt: new Date("2026-10-01T12:00:00.000Z"),
    source: "jopara.md",
    notes: "line one\nline two",
  };
  const csv = glossaryToCsv([row]);
  assert.deepEqual(parseGlossaryCsv("﻿" + csv), [row]);
});

test("rejects a bad register and a missing term column", () => {
  assert.throws(() => parseGlossaryCsv("term,register\nnde,poetic\n"), GlossaryCsvError);
  assert.throws(() => parseGlossaryCsv("word\nnde\n"), GlossaryCsvError);
});

test("defaults: language gn, proposed, everyday, not jopara_ok", () => {
  const [r] = parseGlossaryCsv("term\nkatu\n");
  assert.equal(r.language, "gn");
  assert.equal(r.reviewStatus, "proposed");
  assert.equal(r.register, "everyday");
  assert.equal(r.joparaOk, false);
});
