import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { loadPostStyleGuide } from "@/lib/posts/guides";
import { loadStyleGuide } from "@/lib/scripts/language";
import {
  APPROVED_HEADING,
  approvedTermsBlock,
  assertGeneratableLanguage,
  GuaraniGenerationRefusedError,
  isPureGuarani,
  setApprovedTermsSource,
  withLanguageRules,
} from "./prompt";

afterEach(() => setApprovedTermsSource(null));

const TERM = { term: "mitã", meaningEs: "niño", meaningEn: "child", example: "Los mitã juegan." };

test("the block lists term — meaning — example and the only-these rule", () => {
  const block = approvedTermsBlock([TERM]);
  assert.ok(block.startsWith(APPROVED_HEADING));
  assert.match(block, /- mitã — niño — Los mitã juegan\./);
  assert.match(block, /Usá solo estas palabras guaraníes/);
  assert.match(block, /Nunca uses otro guaraní/);
});

test("an empty glossary says so, and the safe list rules apply", () => {
  const block = approvedTermsBlock([]);
  assert.match(block, /Todavía no hay palabras aprobadas/);
  assert.match(block, /Palabras seguras/);
});

test("only jopara gets the block; other guides are untouched", async () => {
  setApprovedTermsSource(async () => [TERM]);
  assert.equal(await withLanguageRules("es-PY", "GUIDE"), "GUIDE");
  assert.equal(await withLanguageRules("en", "GUIDE"), "GUIDE");
  assert.match(await withLanguageRules("jopara", "GUIDE"), /GUIDE\n\nPALABRAS GUARANÍES APROBADAS/);

  const script = await loadStyleGuide("jopara");
  assert.match(script, /Palabras seguras/);
  assert.match(script, /- mitã — niño/);
  assert.doesNotMatch(await loadStyleGuide("es-PY"), new RegExp(APPROVED_HEADING));
  assert.match(await loadPostStyleGuide("jopara"), /- mitã — niño/);
  assert.doesNotMatch(await loadPostStyleGuide("es-PY"), new RegExp(APPROVED_HEADING));
});

test("a failing source degrades to the empty block", async () => {
  setApprovedTermsSource(async () => {
    throw new Error("no db");
  });
  assert.match(await withLanguageRules("jopara", "G"), /Todavía no hay palabras aprobadas/);
});

test("pure Guaraní generation is refused with a clear message", async () => {
  assert.ok(isPureGuarani("gn") && isPureGuarani("GN-py"));
  assert.ok(!isPureGuarani("jopara") && !isPureGuarani("es-PY"));
  assert.throws(() => assertGeneratableLanguage("gn"), GuaraniGenerationRefusedError);
  await assert.rejects(loadPostStyleGuide("gn"), /never generated/);
});
