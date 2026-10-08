import assert from "node:assert/strict";
import { test } from "node:test";

import { commentPermalink, flattenComments, type IgComment } from "./flatten";
import {
  buildReplyPrompt,
  humanTopics,
  needsHumanNote,
  NEEDS_HUMAN_PREFIX,
  parseReply,
  rankFacts,
  ReplyParseError,
  type ReplyInput,
} from "./prompt";

test("flattenComments skips the account's own comments and replies", () => {
  const comments: IgComment[] = [
    {
      id: "c1",
      text: "¿Cuánto tarda el trámite?",
      username: "maria",
      timestamp: "2026-09-20T10:00:00+0000",
      replies: {
        data: [
          {
            id: "r1",
            text: "Unos 45 días",
            username: "ParaguayResidency",
            timestamp: "2026-09-20T11:00:00+0000",
          },
          { id: "r2", text: "Gracias!", username: "maria", timestamp: "2026-09-20T12:00:00+0000" },
        ],
      },
    },
    {
      id: "c2",
      text: "Pinned info",
      username: "@paraguayresidency",
      timestamp: "2026-09-19T10:00:00+0000",
    },
    { id: "c3", text: "   ", username: "bob", timestamp: "2026-09-21T10:00:00+0000" },
    { id: "c4", text: "Me interesa", username: "juan", timestamp: "2026-09-18T10:00:00+0000" },
  ];
  const flat = flattenComments(comments, "@ParaguayResidency");
  assert.deepEqual(
    flat.map((c) => c.externalCommentId),
    ["c4", "c1", "r2"],
  );
  assert.equal(flat.find((c) => c.externalCommentId === "c1")?.answered, true);
  assert.equal(flat.find((c) => c.externalCommentId === "r2")?.answered, false);
  assert.equal(flat.find((c) => c.externalCommentId === "c4")?.answered, false);
});

test("commentPermalink appends c/<id>/ on instagram.com only", () => {
  assert.equal(
    commentPermalink("https://www.instagram.com/p/ABC123/", "1789"),
    "https://www.instagram.com/p/ABC123/c/1789/",
  );
  assert.equal(
    commentPermalink("https://www.instagram.com/reel/XYZ", "5"),
    "https://www.instagram.com/reel/XYZ/c/5/",
  );
  assert.equal(commentPermalink("https://facebook.com/x", "5"), "https://facebook.com/x");
  assert.equal(commentPermalink(null, "5"), null);
});

test("humanTopics flags prices and legal questions in several languages", () => {
  assert.deepEqual(humanTopics("¿Cuánto cuesta la residencia?"), ["price"]);
  assert.deepEqual(humanTopics("How much is the fee?"), ["price"]);
  assert.deepEqual(humanTopics("Necesito un abogado para el contrato"), ["legal"]);
  assert.deepEqual(humanTopics("Precio y contrato?"), ["price", "legal"]);
  assert.deepEqual(humanTopics("Qué lindo video!"), []);
});

const input: ReplyInput = {
  brand: { name: "Paraguay Residency", niche: "residency", voice: "cercano" },
  platform: "instagram",
  handle: "residenciapy",
  language: "es-PY",
  languageName: "Paraguayan Spanish (castellano paraguayo, voseo)",
  styleGuide: "## Voseo, siempre\n- vos tenés",
  kit: { ctas: ["Escribinos por DM"], dos: "Ser breve", donts: "Prometer plazos" },
  caption: "La residencia tarda unos 45 días con el expediente completo.",
  comment: { author: "maria", text: "¿Cuánto cuesta el trámite?" },
  facts: [
    {
      topic: "plazos",
      claim: "La residencia tarda 45 días",
      verified: true,
      sourceUrl: "https://x",
    },
    { topic: "costos", claim: "El trámite cuesta 600 USD", verified: false, sourceUrl: null },
  ],
  leadUrl: "https://crm.example.com/f/1?utm_source=instagram",
};

test("buildReplyPrompt carries style guide, kit, facts by verification, caption and a human note", () => {
  const prompt = buildReplyPrompt(input);
  assert.match(prompt, /Voseo, siempre/);
  assert.match(prompt, /Escribinos por DM/);
  assert.match(prompt, /Don't: Prometer plazos/);
  assert.match(prompt, /VERIFIED: La residencia tarda 45 días/);
  assert.match(prompt, /UNVERIFIED — hedge it: El trámite cuesta 600 USD/);
  assert.match(prompt, /45 días con el expediente completo/);
  assert.match(prompt, /@maria/);
  assert.match(prompt, /touches price/);
  assert.match(prompt, /LEAD LINK/);
});

test("rankFacts puts facts sharing words with the comment first", () => {
  const ranked = rankFacts(
    [
      { topic: "visa", claim: "Visa de turista 90 días", verified: true, sourceUrl: null },
      { topic: "costos", claim: "El trámite cuesta 600 USD", verified: true, sourceUrl: null },
    ],
    "¿Cuánto cuesta el tramite?",
    "",
  );
  assert.equal(ranked[0].topic, "costos");
});

test("parseReply keeps the model's flag and adds the keyword flag", () => {
  const plain = parseReply(
    JSON.stringify({ reply: "¡Gracias, María!", needsHuman: false, humanReason: "" }),
    "Qué lindo",
  );
  assert.deepEqual(plain, { reply: "¡Gracias, María!", needsHuman: false, humanReason: "" });

  const forced = parseReply(
    JSON.stringify({ reply: "Escribinos por DM", needsHuman: false, humanReason: "" }),
    "¿Cuánto cuesta?",
  );
  assert.equal(forced.needsHuman, true);
  assert.match(forced.humanReason, /price/);

  const model = parseReply(
    JSON.stringify({ reply: "Te escribimos", needsHuman: true, humanReason: "Own case" }),
    "Mi caso es raro",
  );
  assert.equal(model.needsHuman, true);
  assert.equal(model.humanReason, "Own case");

  assert.throws(() => parseReply("not json", "x"), ReplyParseError);
  assert.throws(() => parseReply(JSON.stringify({ reply: " " }), "x"), ReplyParseError);
});

test("needsHumanNote reads the prefixed error column", () => {
  assert.equal(needsHumanNote(`${NEEDS_HUMAN_PREFIX}Asks about price.`), "Asks about price.");
  assert.equal(needsHumanNote("some other error"), null);
  assert.equal(needsHumanNote(null), null);
});
