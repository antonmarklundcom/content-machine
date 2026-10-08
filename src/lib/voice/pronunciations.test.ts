import assert from "node:assert/strict";
import { test } from "node:test";

import {
  applyPronunciations,
  scopeRank,
  selectRules,
  type PronunciationRule,
} from "./pronunciations";

function rule(
  partial: Partial<PronunciationRule> & { term: string; sayAs: string },
): PronunciationRule {
  return { language: "*", scope: "global", reviewStatus: "approved", ...partial };
}

const ctx = { language: "es-PY" };

test("whole word, case-insensitive", () => {
  const rules = [rule({ term: "Ypacaraí", sayAs: "Ipacaraí" })];
  assert.equal(
    applyPronunciations("Lago ypacaraí y YPACARAÍ, no Ypacaraíes.", rules, ctx).text,
    "Lago Ipacaraí y Ipacaraí, no Ypacaraíes.",
  );
});

test("does not match inside a word with accented letters around it", () => {
  const rules = [rule({ term: "che", sayAs: "ché" })];
  assert.equal(applyPronunciations("noche chee ñche che", rules, ctx).text, "noche chee ñche ché");
});

test("Guaraní letters: ñ, ỹ, g̃ and the puso are word characters", () => {
  const rules = [
    rule({ term: "ka'a", sayAs: "ka a" }),
    rule({ term: "y", sayAs: "ü" }),
    rule({ term: "mitã", sayAs: "mitán" }),
    rule({ term: "g̃uahẽ", sayAs: "nguajé" }),
  ];
  const out = applyPronunciations("ka'a, ka’a, mitã, ỹ y g̃uahẽ, aguahẽ", rules, ctx).text;
  // `y` alone is rewritten; `ỹ` is a different letter; both puso forms match; g̃ (g + U+0303) is one word.
  assert.equal(out, "ka a, ka a, mitán, ỹ ü nguajé, aguahẽ");
});

test("decomposed input is normalised before matching", () => {
  const rules = [rule({ term: "Caacupé", sayAs: "Caacupé!" })];
  const decomposed = "Caacupé";
  assert.equal(applyPronunciations(decomposed, rules, ctx).text, "Caacupé!");
});

test("longest term first, and a respelling is never rewritten again", () => {
  const rules = [
    rule({ term: "San Lorenzo", sayAs: "San Lorénso" }),
    rule({ term: "San", sayAs: "Saan" }),
    rule({ term: "Lorénso", sayAs: "XX" }),
  ];
  assert.equal(
    applyPronunciations("San Lorenzo y San Bernardino", rules, ctx).text,
    "San Lorénso y Saan Bernardino",
  );
});

test("narrower scope wins, out-of-play scopes are ignored", () => {
  const rules = [
    rule({ term: "Tito", sayAs: "global" }),
    rule({ term: "Tito", sayAs: "provider", scope: "provider:azure" }),
    rule({ term: "Tito", sayAs: "story", scope: "story:tito" }),
    rule({ term: "Tito", sayAs: "other story", scope: "story:other" }),
  ];
  assert.equal(applyPronunciations("Tito", rules, ctx).text, "global");
  assert.equal(applyPronunciations("Tito", rules, { ...ctx, provider: "azure" }).text, "provider");
  assert.equal(
    applyPronunciations("Tito", rules, { ...ctx, provider: "elevenlabs" }).text,
    "global",
  );
  assert.equal(
    applyPronunciations("Tito", rules, { ...ctx, provider: "azure", scopes: ["story:tito"] }).text,
    "story",
  );
});

test("language must match or be *; exact language beats *", () => {
  const rules = [
    rule({ term: "pora", sayAs: "porá-any" }),
    rule({ term: "pora", sayAs: "porá-jopara", language: "jopara" }),
    rule({ term: "hello", sayAs: "jelou", language: "en" }),
  ];
  assert.equal(
    applyPronunciations("pora hello", rules, { language: "jopara" }).text,
    "porá-jopara hello",
  );
  assert.equal(applyPronunciations("pora hello", rules, { language: "en" }).text, "porá-any jelou");
});

test("only approved rows by default; includeProposed for previews; rejected never", () => {
  const rules = [
    rule({ term: "Asunción", sayAs: "Asunsión", reviewStatus: "proposed" }),
    rule({ term: "Luque", sayAs: "Lu-ke", reviewStatus: "rejected" }),
  ];
  assert.equal(applyPronunciations("Asunción Luque", rules, ctx).text, "Asunción Luque");
  const preview = applyPronunciations("Asunción Luque", rules, { ...ctx, includeProposed: true });
  assert.equal(preview.text, "Asunsión Luque");
  assert.deepEqual(preview.applied, [
    { term: "Asunción", sayAs: "Asunsión", scope: "global", count: 1 },
  ]);
});

test("regex characters in terms are literal", () => {
  const rules = [rule({ term: "U.S.", sayAs: "iu es" }), rule({ term: "a+b", sayAs: "a más b" })];
  assert.equal(
    applyPronunciations("the U.S. and a+b, not UxSx", rules, ctx).text,
    "the iu es and a más b, not UxSx",
  );
});

test("applied lists counts", () => {
  const rules = [rule({ term: "mba'e", sayAs: "mbaé" })];
  const r = applyPronunciations("mba'e mba'e", rules, ctx);
  assert.equal(r.applied[0].count, 2);
});

test("scopeRank and selectRules", () => {
  assert.equal(scopeRank("global", ctx), 0);
  assert.equal(scopeRank("brand:propia", { ...ctx, scopes: ["brand:propia"] }), 2);
  assert.equal(scopeRank("brand:propia", ctx), null);
  const picked = selectRules(
    [
      rule({ term: "ab", sayAs: "1" }),
      rule({ term: "abc", sayAs: "2" }),
      rule({ term: "AB", sayAs: "3", language: "es-PY" }),
    ],
    ctx,
  );
  assert.deepEqual(
    picked.map((r) => r.sayAs),
    ["2", "3"],
  );
});
