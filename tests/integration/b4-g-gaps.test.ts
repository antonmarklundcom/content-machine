import { insertReturning } from "@/db/mutations";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";

import { eq } from "drizzle-orm";

import { db, schema } from "@/db";
import { validate } from "@/lib/ai-fake";
import {
  findGaps,
  gatherGapInputs,
  GapError,
  makeIdeaFromGap,
  setGapStatus,
  listGaps,
  type ModelCall,
} from "@/lib/gaps/find";

import { resetTables, teardown } from "./setup";

/**
 * Phase G content gaps (build 4 §3.G): inputs gathered from competitor posts,
 * reports, audience questions and the brand's own work; the model's answer
 * validated against them; "Make idea" inserts a proposed idea and links it.
 */

const NOW = new Date("2026-09-27T12:00:00Z");

function fakeModel(answer: (prompt: string) => unknown) {
  const calls: Parameters<ModelCall>[0][] = [];
  const model: ModelCall = async (opts) => {
    calls.push(opts);
    const a = answer(opts.prompt);
    validate(a, opts.schema);
    return { text: JSON.stringify(a), costUsd: 0.004, groundingQueries: 0 };
  };
  return { model, calls };
}

let cp = 0;
let question = 0;
let report = 0;
let own = 0;

beforeEach(async () => {
  await resetTables();
  await db.insert(schema.brands).values({
    id: "residencia",
    name: "Residencia Paraguay",
    domain: "residencia.com.py",
    niche: "residencia",
    market: "paraguay",
    language: "es",
    platforms: ["instagram"],
  });
  const [comp] = await insertReturning(db, schema.socialCompetitors, {
    brandId: "residencia",
    platform: "instagram",
    handle: "rival",
  });
  const cps = await insertReturning(db, schema.competitorPosts, [
    {
      competitorId: comp.id,
      externalId: "m1",
      caption: "Cómo abrir una cuenta bancaria en Paraguay siendo extranjero",
      mediaType: "REEL",
      likes: 900,
      comments: 80,
      postedAt: new Date("2026-09-10T00:00:00Z"),
      permalink: "https://www.instagram.com/p/RIVAL1/",
    },
    {
      competitorId: comp.id,
      externalId: "m-old",
      caption: "Old post",
      postedAt: new Date("2026-01-10T00:00:00Z"),
    },
  ]);
  cp = cps[0].id;
  const [q] = await insertReturning(db, schema.audienceQuestions, {
    brandId: "residencia",
    question: "¿Puedo trabajar con la residencia temporal?",
    askCount: 7,
  });
  question = q.id;
  await db
    .insert(schema.audienceQuestions)
    .values({ brandId: "residencia", question: "Dismissed one", status: "dismissed" });
  const [rep] = await insertReturning(db, schema.competitorReports, {
    brandId: "residencia",
    periodDays: 7,
    body: {
      summary: "s",
      winners: [
        {
          videoId: 1,
          title: "Bank account in PY",
          channel: "x",
          outlierScore: 4,
          whyItWorked: "Practical",
        },
      ],
      patterns: ["Step-by-step bank videos"],
      ideas: [],
    },
  });
  report = rep.id;
  const [p] = await insertReturning(db, schema.posts, {
    accountId: 1,
    brandId: "residencia",
    format: "carousel",
    status: "published",
    title: "45 días para la residencia",
    publishedAt: new Date("2026-09-01T00:00:00Z"),
  });
  own = p.id;
});

after(teardown);

test("gatherGapInputs reads recent competitor posts, reports, open questions and own work", async () => {
  const inputs = await gatherGapInputs("residencia", { now: NOW });
  assert.deepEqual(
    inputs.market.map((i) => i.ref),
    [`cp:${cp}`, `report:${report}`, `q:${question}`],
  );
  assert.deepEqual(
    inputs.own.map((i) => i.ref),
    [`post:${own}`],
  );
});

test("findGaps stores only gaps whose evidence exists; make idea links it", async () => {
  const fake = fakeModel(() => ({
    gaps: [
      {
        topic: "Cuenta bancaria para extranjeros",
        angle: "Paso a paso, con lo que piden los bancos",
        evidence: [
          { ref: `cp:${cp}`, note: "Reel del competidor con 900 likes" },
          { ref: `report:${report}`, note: "Videos de bancos funcionan" },
        ],
        score: 9,
      },
      {
        topic: "Trabajar con residencia temporal",
        angle: "Qué podés hacer desde el día uno",
        evidence: [{ ref: `q:${question}`, note: "Preguntado 7 veces" }],
        score: 8,
      },
      { topic: "Inventado", angle: "x", evidence: [{ ref: "cp:9999", note: "x" }], score: 10 },
    ],
  }));
  const r = await findGaps("residencia", { model: fake.model, now: NOW });
  assert.equal(fake.calls.length, 1);
  assert.match(fake.calls[0].prompt, new RegExp(`cp:${cp}`));
  assert.match(fake.calls[0].prompt, /45 días para la residencia/);
  assert.ok(fake.calls[0].estimateUsd > 0);
  assert.equal(r.gaps.length, 2);
  assert.equal(r.dropped.length, 1);

  const listed = await listGaps("residencia");
  assert.deepEqual(
    listed.map((g) => [g.topic, g.score]),
    [
      ["Cuenta bancaria para extranjeros", 9],
      ["Trabajar con residencia temporal", 8],
    ],
  );
  assert.equal(listed[0].evidence[0].kind, "competitor_post");

  const made = await makeIdeaFromGap(listed[0].id);
  assert.equal(made.created, true);
  const [idea] = await db.select().from(schema.ideas).where(eq(schema.ideas.id, made.ideaId));
  assert.equal(idea.brandId, "residencia");
  assert.equal(idea.title, "Cuenta bancaria para extranjeros");
  assert.equal(idea.status, "proposed");
  assert.equal(idea.platform, "instagram");
  assert.equal(idea.format, "carousel");
  assert.match(idea.draftCopy, /Reel del competidor/);
  const [gap] = await db
    .select()
    .from(schema.contentGaps)
    .where(eq(schema.contentGaps.id, listed[0].id));
  assert.equal(gap.status, "planned");
  assert.equal(gap.ideaId, made.ideaId);

  const again = await makeIdeaFromGap(listed[0].id);
  assert.deepEqual(again, { ideaId: made.ideaId, created: false });
  assert.equal((await db.select().from(schema.ideas)).length, 1);

  await setGapStatus(listed[1].id, "dismissed");
  assert.equal((await listGaps("residencia", ["new"])).length, 0);
  assert.equal((await listGaps("residencia", ["dismissed"])).length, 1);
});

test("findGaps refuses with nothing to compare, and when no gap checks out", async () => {
  await db.insert(schema.brands).values({
    id: "empty",
    name: "Empty",
    domain: "e.com",
    niche: "x",
    market: "paraguay",
    platforms: ["instagram"],
  });
  const fake = fakeModel(() => ({ gaps: [] }));
  await assert.rejects(findGaps("empty", { model: fake.model, now: NOW }), GapError);
  assert.equal(fake.calls.length, 0, "no model call without market inputs");

  const bad = fakeModel(() => ({
    gaps: [{ topic: "Made up", angle: "x", evidence: [{ ref: "q:424242", note: "x" }], score: 5 }],
  }));
  await assert.rejects(findGaps("residencia", { model: bad.model, now: NOW }), /did not check out/);
  assert.equal((await db.select().from(schema.contentGaps)).length, 0);
});
