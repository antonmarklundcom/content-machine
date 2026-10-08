import { insertReturning } from "@/db/mutations";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";

import { eq } from "drizzle-orm";

import { db, schema } from "@/db";
import { validate } from "@/lib/ai-fake";
import type { ModelCall } from "@/lib/comments/draft";
import { draftComment, draftComments, patchComment, CommentDraftError } from "@/lib/comments/draft";
import { NEEDS_HUMAN_PREFIX } from "@/lib/comments/prompt";
import { newCommentIds, syncComments } from "@/lib/comments/sync";
import { generateEncryptionKey } from "@/lib/crypto";
import { setGraphFetch, type GraphFetch } from "@/lib/meta/graph";
import { saveMetaConnection } from "@/lib/meta/integration";

import { resetTables, teardown } from "./setup";

/**
 * Phase G comment drafts (build 4 §3.G, PLAN-build4 §1.11): the Graph sync
 * upserts comments and skips the account's own, re-syncs do not duplicate,
 * drafting assembles the account's language, style guide, kit and facts and
 * flags price questions for a person. No test reaches Meta or Google.
 */

const NOW = new Date("2026-09-27T12:00:00Z");
const IG_ID = "17841400000000001";
const MEDIA_A = "18000000000000001";
const MEDIA_OLD = "18000000000000009";
const TOKEN = "EAAFAKElongLivedUserToken0000000000000";

type Answer = { status?: number; body: unknown };

const COMMENTS_A = {
  data: [
    {
      id: "c-1",
      text: "¿Cuánto cuesta el trámite?",
      username: "maria_py",
      timestamp: "2026-09-25T10:00:00+0000",
      replies: { data: [] },
    },
    {
      id: "c-2",
      text: "¡Muy útil, gracias!",
      username: "juan",
      timestamp: "2026-09-25T11:00:00+0000",
      replies: {
        data: [
          {
            id: "r-own",
            text: "¡A vos!",
            username: "residenciapy",
            timestamp: "2026-09-25T12:00:00+0000",
          },
        ],
      },
    },
    {
      id: "c-own",
      text: "Link en la bio",
      username: "residenciapy",
      timestamp: "2026-09-25T09:00:00+0000",
    },
  ],
  paging: { cursors: { after: "x" } },
};

function graph(override?: (path: string) => Answer | undefined): {
  fetch: GraphFetch;
  paths: string[];
} {
  const paths: string[] = [];
  const fetchImpl: GraphFetch = async (raw) => {
    const url = new URL(raw);
    const path = url.pathname.replace(/^\/v\d+\.\d+\//, "");
    paths.push(path);
    const answer: Answer =
      override?.(path) ??
      (path === `${MEDIA_A}/comments`
        ? { body: COMMENTS_A }
        : { status: 404, body: { error: { message: `no fixture for ${path}`, code: 803 } } });
    return new Response(JSON.stringify(answer.body), {
      status: answer.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetch: fetchImpl, paths };
}

/** A `structuredJson` stand-in: checks the answer against the caller's schema and records the call. */
function fakeModel(answer: unknown) {
  const calls: Parameters<ModelCall>[0][] = [];
  const model: ModelCall = async (opts) => {
    calls.push(opts);
    validate(answer, opts.schema);
    return { text: JSON.stringify(answer), costUsd: 0.0012, groundingQueries: 0 };
  };
  return { model, calls };
}

let account = 0;
let postA = 0;

beforeEach(async () => {
  process.env.ENCRYPTION_KEY = generateEncryptionKey();
  setGraphFetch(null);
  await resetTables();
  await db.insert(schema.brandFamilies).values({ id: "py-res", name: "Paraguay residency" });
  await db.insert(schema.brands).values({
    id: "residencia",
    name: "Residencia Paraguay",
    domain: "residencia.com.py",
    niche: "residencia",
    market: "paraguay",
    language: "es",
    voice: "cercano",
    platforms: ["instagram"],
    familyId: "py-res",
  });
  const conn = await saveMetaConnection({
    token: TOKEN,
    expiresAt: new Date(NOW.getTime() + 50 * 86_400_000),
    userId: "10000000000001",
    userName: "Anton",
    scopes: ["instagram_basic", "instagram_manage_comments"],
  });
  const [acc] = await insertReturning(db, schema.socialAccounts, {
    brandId: "residencia",
    platform: "instagram",
    handle: "ResidenciaPY",
    language: "es-PY",
    status: "active",
    isProfessional: true,
    externalId: IG_ID,
    integrationId: conn.id,
  });
  account = acc.id;
  const [a] = await insertReturning(db, schema.posts, {
    accountId: account,
    brandId: "residencia",
    format: "carousel",
    status: "published",
    title: "45 días",
    caption: "La residencia temporal tarda unos 45 días con el expediente completo.",
    publishedAt: new Date("2026-09-24T12:00:00Z"),
    externalMediaId: MEDIA_A,
    permalink: "https://www.instagram.com/p/ABC/",
    leadUrl: "https://crm.example.com/f/1?utm_source=instagram",
  });
  postA = a.id;
  // Too old to be read, and a draft that has no media id: neither is asked for.
  await db.insert(schema.posts).values([
    {
      accountId: account,
      brandId: "residencia",
      format: "reel",
      status: "published",
      publishedAt: new Date("2026-06-01T12:00:00Z"),
      externalMediaId: MEDIA_OLD,
    },
    { accountId: account, brandId: "residencia", format: "reel", status: "drafting" },
  ]);
  await db.insert(schema.brandKits).values({
    brandId: "residencia",
    ctas: ["Escribinos por DM"],
    dos: "Responder en voseo",
    donts: "Prometer plazos exactos",
  });
  await db.insert(schema.facts).values([
    {
      familyId: "py-res",
      language: "es",
      verified: true,
      topic: "plazos",
      claim: "La residencia temporal tarda unos 45 días con el expediente completo.",
    },
    {
      brandId: "residencia",
      language: "es",
      verified: false,
      topic: "costos",
      claim: "El trámite cuesta alrededor de 600 USD.",
    },
    { familyId: "py-res", language: "en", verified: true, topic: "x", claim: "English only fact" },
  ]);
});

after(async () => {
  setGraphFetch(null);
  await teardown();
});

test("sync upserts other people's comments, skips our own, marks answered ones replied", async () => {
  const g = graph();
  const r = await syncComments({ fetch: g.fetch, now: NOW });
  assert.deepEqual(r.errors, []);
  assert.equal(r.accounts, 1);
  assert.equal(r.posts, 1);
  assert.equal(r.inserted, 2);
  assert.deepEqual(
    g.paths.filter((p) => p.endsWith("/comments")),
    [`${MEDIA_A}/comments`],
    "only recent published posts with a media id are read",
  );

  const rows = await db.select().from(schema.commentDrafts).orderBy(schema.commentDrafts.id);
  assert.deepEqual(
    rows.map((c) => [c.externalCommentId, c.status, c.author]),
    [
      ["c-1", "new", "maria_py"],
      ["c-2", "replied", "juan"],
    ],
  );
  assert.equal(rows[0].postId, postA);
  assert.equal(rows[0].language, "es-PY");
  assert.equal(rows[0].platform, "instagram");
  assert.equal(rows[0].externalMediaId, MEDIA_A);

  // A second run inserts nothing and leaves a worked-on row alone.
  await db
    .update(schema.commentDrafts)
    .set({ status: "drafted", draft: "Hola" })
    .where(eq(schema.commentDrafts.externalCommentId, "c-1"));
  const again = await syncComments({ fetch: graph().fetch, now: NOW });
  assert.equal(again.inserted, 0);
  const [c1] = await db
    .select()
    .from(schema.commentDrafts)
    .where(eq(schema.commentDrafts.externalCommentId, "c-1"));
  assert.equal(c1.status, "drafted");
  assert.equal(c1.draft, "Hola");
  assert.equal((await db.select().from(schema.commentDrafts)).length, 2);
});

test("sync: a rejected token marks the integration expired", async () => {
  const g = graph(() => ({
    status: 400,
    body: { error: { message: "Error validating access token", code: 190 } },
  }));
  const r = await syncComments({ fetch: g.fetch, now: NOW });
  assert.equal(r.expired.length, 1);
  const [row] = await db.select().from(schema.integrations);
  assert.equal(row.status, "expired");
  assert.equal((await db.select().from(schema.commentDrafts)).length, 0);
});

test("draft assembles language, style guide, kit, caption and facts; price question needs a person", async () => {
  await syncComments({ fetch: graph().fetch, now: NOW });
  const [id] = await newCommentIds([account]);
  const fake = fakeModel({
    reply: "¡Hola! Te escribimos por DM con los detalles, fijate en tu bandeja.",
    needsHuman: false,
    humanReason: "",
  });
  const out = await draftComment(id, { model: fake.model });

  assert.equal(fake.calls.length, 1);
  const call = fake.calls[0];
  assert.equal(call.webSearch, false);
  assert.ok(call.estimateUsd > 0);
  assert.match(call.system, /never sent|nothing you write is sent/i);
  assert.match(call.prompt, /Paraguayan Spanish/);
  assert.match(call.prompt, /tag es-PY/);
  assert.match(call.prompt, /Voseo/i, "the es-PY style guide is in the prompt");
  assert.match(call.prompt, /Escribinos por DM/);
  assert.match(call.prompt, /Don't: Prometer plazos exactos/);
  assert.match(call.prompt, /expediente completo/);
  assert.match(call.prompt, /VERIFIED: La residencia temporal/);
  assert.match(call.prompt, /UNVERIFIED — hedge it: El trámite cuesta/);
  assert.doesNotMatch(call.prompt, /English only fact/, "facts in another language stay out");
  assert.match(call.prompt, /crm\.example\.com/);
  assert.match(call.prompt, /@maria_py/);

  assert.equal(out.needsHuman, true, "a price question is flagged even when the model did not");
  assert.equal(out.row.status, "drafted");
  assert.match(out.row.draft ?? "", /fijate/);
  assert.ok(out.row.error?.startsWith(NEEDS_HUMAN_PREFIX));
});

test("draftComments + patches: approve, mark replied, refuse drafting a replied comment", async () => {
  await syncComments({ fetch: graph().fetch, now: NOW });
  const fake = fakeModel({ reply: "¡Gracias por escribir!", needsHuman: false, humanReason: "" });
  const ids = await newCommentIds();
  const report = await draftComments(ids, { model: fake.model });
  assert.equal(report.drafted, 1);
  assert.equal(report.needsHuman, 1);
  assert.ok(Math.abs(report.costUsd - 0.0012) < 1e-9);

  const id = ids[0];
  const approved = await patchComment(id, {
    kind: "approve",
    draft: "¡Gracias, María! Te escribimos.",
  });
  assert.equal(approved.status, "approved");
  assert.equal(approved.draft, "¡Gracias, María! Te escribimos.");
  const replied = await patchComment(id, { kind: "replied" });
  assert.equal(replied.status, "replied");
  await assert.rejects(draftComment(id, { model: fake.model }), CommentDraftError);
  await assert.rejects(patchComment(id, { kind: "edit", draft: "x" }), CommentDraftError);
  const reopened = await patchComment(id, { kind: "reopen" });
  assert.equal(reopened.status, "drafted");
  assert.equal(fake.calls.length, 1, "the refused draft made no model call");
});
