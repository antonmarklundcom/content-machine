import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildQuestionsPrompt,
  isLikelyQuestion,
  MAX_QUESTION_CLUSTERS,
  MAX_QUESTION_EXAMPLES,
  normalizeQuestion,
  validateQuestionClusters,
} from "./question-filter";

test("question marks and question words count, in English and Spanish", () => {
  for (const q of [
    "How long does the residency take now",
    "is this still valid in 2026?",
    "¿Cuánto cuesta la cédula",
    "Cuanto sale el tramite completo",
    "Great video. Where do I get the apostille",
    "Alguien sabe si se puede hacer desde Suecia",
    "does anyone know if the police certificate expires",
    "Me pregunto si vale la pena",
    "Por que tarda tanto migraciones",
  ]) {
    assert.ok(isLikelyQuestion(q), q);
  }
});

test("praise, statements and noise do not", () => {
  for (const c of [
    "Great video, thanks!",
    "Que buen video, muy claro",
    "Como siempre excelente contenido",
    "Es lo mejor que vi sobre el tema",
    "Hay que hacerlo con tiempo",
    "first",
    "🔥🔥🔥",
    "x".repeat(2_500) + "?",
  ]) {
    assert.equal(isLikelyQuestion(c), false, c);
  }
});

test("normalizeQuestion folds case, accents and punctuation", () => {
  assert.equal(normalizeQuestion("¿Cuánto   cuesta la Cédula?"), "cuanto cuesta la cedula");
  assert.equal(
    normalizeQuestion("Cuanto cuesta la cedula"),
    normalizeQuestion("¿CUÁNTO cuesta la cédula?!"),
  );
  assert.equal(normalizeQuestion("?!"), "");
});

test("clusters are cleaned: blanks dropped, duplicates merged, ids and examples bounded", () => {
  const clusters = validateQuestionClusters(
    {
      questions: [
        {
          question: "  How long does it take? ",
          askCount: 3,
          examples: ["a", "b", ""],
          videoIds: [1, 99],
        },
        {
          question: "how long does it take",
          askCount: 2,
          examples: ["b", "c", "d", "e", "f", "g"],
          videoIds: [2],
        },
        { question: "", askCount: 9, examples: [], videoIds: [1] },
        { question: "What does it cost?", askCount: 0, examples: [42], videoIds: ["2"] },
      ],
    },
    [1, 2],
  );
  assert.equal(clusters.length, 2);
  const [first, second] = clusters;
  assert.equal(first.question, "How long does it take?");
  assert.equal(first.askCount, 5, "merged counts add up");
  assert.deepEqual(first.examples, ["a", "b", "c", "d", "e"]);
  assert.equal(first.examples.length, MAX_QUESTION_EXAMPLES);
  assert.deepEqual(first.videoIds, [1, 2], "unknown video 99 dropped");
  assert.equal(second.askCount, 1, "a zero count becomes one");
  assert.deepEqual(second.examples, [], "non-strings dropped");
  assert.deepEqual(second.videoIds, [2]);
});

test("at most twenty clusters, most asked first", () => {
  const questions = Array.from({ length: 30 }, (_, i) => ({
    question: `Question number ${i}?`,
    askCount: i + 1,
    examples: [],
    videoIds: [],
  }));
  const clusters = validateQuestionClusters({ questions }, []);
  assert.equal(clusters.length, MAX_QUESTION_CLUSTERS);
  assert.equal(clusters[0].askCount, 30);
});

test("an answer without a questions list is refused", () => {
  assert.throws(() => validateQuestionClusters({}, []));
  assert.throws(() => validateQuestionClusters(null, []));
});

test("the prompt tags each comment with its video and flattens line breaks", () => {
  const prompt = buildQuestionsPrompt({ name: "Pozo", niche: "wells" }, [
    { videoId: 7, text: "How deep\nshould it be?" },
  ]);
  assert.match(prompt, /\[video 7\] How deep should it be\?/);
});
