import assert from "node:assert/strict";
import { test } from "node:test";

import { buildGapPrompt, gapIdeaCopy, refKind, validateGaps, type GapInputs } from "./validate";

const inputs: GapInputs = {
  brand: { id: "res", name: "Residency", niche: "residency", market: "paraguay", language: "es" },
  market: [
    {
      kind: "competitor_post",
      ref: "cp:1",
      text: "REEL, 900 likes: Cómo abrir una cuenta bancaria",
    },
    { kind: "question", ref: "q:2", text: "asked 7×: ¿Puedo trabajar con la residencia temporal?" },
    { kind: "report", ref: "report:3", text: "Bank account videos took off" },
  ],
  own: [{ kind: "own_post", ref: "post:4", text: "45 días para la residencia" }],
};

test("buildGapPrompt lists every input under its ref", () => {
  const prompt = buildGapPrompt(inputs);
  for (const ref of ["cp:1", "q:2", "report:3", "post:4"]) assert.match(prompt, new RegExp(ref));
  assert.match(prompt, /Find 5–10 gaps/);
});

test("validateGaps keeps real evidence, drops made-up refs and own-only gaps", () => {
  const { gaps, dropped } = validateGaps(
    {
      gaps: [
        {
          topic: "Cuenta bancaria",
          angle: "Paso a paso",
          evidence: [
            { ref: "cp:1", note: "Competitor reel did well" },
            { ref: "cp:999", note: "invented" },
            { ref: "cp:1", note: "duplicate" },
          ],
          score: 8.6,
        },
        { topic: "Invented", angle: "", evidence: [{ ref: "cp:42", note: "x" }], score: 9 },
        { topic: "Own only", angle: "x", evidence: [{ ref: "post:4", note: "x" }], score: 9 },
        { topic: "cuenta bancaria", angle: "dup", evidence: [{ ref: "q:2", note: "x" }], score: 5 },
        { topic: "Trabajar", angle: "", evidence: [{ ref: "q:2", note: "" }], score: 42 },
        { topic: "", evidence: [{ ref: "q:2", note: "" }], score: 3 },
      ],
    },
    inputs,
  );
  assert.deepEqual(
    gaps.map((g) => [g.topic, g.score]),
    [
      ["Trabajar", 10],
      ["Cuenta bancaria", 9],
    ],
  );
  assert.deepEqual(gaps[1].evidence, [
    { kind: "competitor_post", ref: "cp:1", note: "Competitor reel did well" },
  ]);
  assert.equal(gaps[0].angle, null);
  assert.match(gaps[0].evidence[0].note, /trabajar/, "an empty note falls back to the input text");
  assert.equal(dropped.length, 4);
});

test("validateGaps caps at 10 and survives a non-list", () => {
  const many = Array.from({ length: 13 }, (_, i) => ({
    topic: `T${i}`,
    angle: "a",
    evidence: [{ ref: "q:2", note: "n" }],
    score: (i % 10) + 1,
  }));
  const { gaps, dropped } = validateGaps({ gaps: many }, inputs);
  assert.equal(gaps.length, 10);
  assert.equal(dropped.length, 3);
  assert.ok(gaps.every((g, i) => i === 0 || g.score <= gaps[i - 1].score));
  assert.deepEqual(validateGaps(null, inputs).gaps, []);
});

test("refKind and gapIdeaCopy", () => {
  assert.equal(refKind("cp:1"), "competitor_post");
  assert.equal(refKind("script:9"), "script");
  assert.equal(refKind("nope:1"), null);
  const copy = gapIdeaCopy({
    topic: "Cuenta bancaria",
    angle: null,
    evidence: [{ kind: "competitor_post", ref: "cp:1", note: "Reel did well" }],
  });
  assert.equal(copy.title, "Cuenta bancaria");
  assert.equal(copy.angle, "Cuenta bancaria");
  assert.match(copy.draftCopy, /Reel did well \(cp:1\)/);
});
