import assert from "node:assert/strict";
import { test } from "node:test";

import { findUnapprovedGuarani } from "./warnings";

test("plain Spanish and the safe list raise nothing", () => {
  const text = "Nde, fijate este papel. Ndaje que tarda noventa días. Aguyje, che ra'a. Iporã.";
  assert.deepEqual(findUnapprovedGuarani(text, []), []);
});

test("nasal letters, g̃, the puso and known words are flagged with positions", () => {
  const text = "Ko'ãga jaha. Mitã porã, ñande; g̃uahẽ ha'e.";
  const warnings = findUnapprovedGuarani(text, []);
  assert.deepEqual(
    warnings.map((w) => w.word),
    ["Ko'ãga", "Mitã", "porã", "ñande", "g̃uahẽ", "ha'e"],
  );
  for (const w of warnings) assert.equal(text.slice(w.index, w.index + w.length), w.word);
  assert.equal(warnings.find((w) => w.word === "ha'e")?.reason, "puso");
  assert.equal(warnings.find((w) => w.word === "ñande")?.reason, "known");
  assert.equal(warnings.find((w) => w.word === "g̃uahẽ")?.reason, "nasal");
});

test("approved terms (and each word of a multi-word term) are allowed", () => {
  assert.deepEqual(findUnapprovedGuarani("Ko’ãga mitã porã.", ["ko'ãga", "mitã porã"]), []);
});

test("English contractions are not mistaken for the puso", () => {
  assert.deepEqual(findUnapprovedGuarani("Don't worry, it's fine.", []), []);
});
