import { insertReturning } from "@/db/mutations";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, beforeEach, test } from "node:test";

import { eq } from "drizzle-orm";

import { db, schema } from "@/db";
import { POST as generate } from "@/app/api/generate/route";
import { POST as createPost } from "@/app/api/posts/route";
import { PATCH as patchPost } from "@/app/api/posts/[id]/route";
import { POST as adapt } from "@/app/api/posts/[id]/adapt/route";
import { POST as regenerate } from "@/app/api/posts/[id]/regenerate/route";
import { GET as exportPost } from "@/app/api/posts/[id]/export/route";
import {
  messageCostUsd,
  readUsage,
  transcribeClip,
  TranscribeRefusedError,
  TRANSCRIBE_MAX_SECONDS,
} from "@/lib/ai";
import { fakeGeminiClient, PAYLOADS, USAGE, WEB_SEARCH_QUERIES } from "@/lib/ai-fake";
import { validatePostDraft, type PostDraft } from "@/lib/posts/contract";
import type { PostBrief, PostPack } from "@/lib/posts/export";
import { monthToDateUsd } from "@/lib/spend";

import { callRoute, jsonPost, signIn } from "./route";
import { resetTables, teardown } from "./setup";

/**
 * O11's post engine against the Gemini test double (PLAN.md §5.O11): drafting
 * from an idea and from a topic, adapting across a family, rewriting one
 * section, the free edits and exports, topic-first `/api/generate`, and clip
 * transcription. Money is computed from the fake's usage through `pricing.ts`,
 * never hardcoded.
 */

const FAMILY = "residency-family";
const brand = (id: string, language: string, familyId: string | null = FAMILY) => ({
  id,
  name: `Brand ${id}`,
  domain: `${id}.example`,
  niche: "residency",
  market: "global",
  language,
  voice: `Voice of ${id}`,
  platforms: ["instagram"],
  familyId,
});

let owner: Record<string, string> = {};
let accounts: Record<string, number> = {};

beforeEach(async () => {
  process.env.MONTHLY_SPEND_CAP_USD = "5";
  await resetTables();
  await db.insert(schema.brandFamilies).values({ id: FAMILY, name: "Residency family" });
  await db
    .insert(schema.brands)
    .values([
      brand("alpha", "en"),
      brand("beta", "es"),
      brand("gamma", "pt-BR"),
      brand("delta", "de"),
      brand("solo", "en", null),
    ]);
  const rows = await insertReturning(db, schema.socialAccounts, [
    { brandId: "alpha", platform: "instagram", handle: "alpha_en", status: "active" },
    { brandId: "beta", platform: "instagram", handle: "beta_es", status: "active" },
    { brandId: "gamma", platform: "instagram", handle: "gamma_pt", status: "active" },
    // Not adapted to: another platform, and a planned account.
    { brandId: "beta", platform: "tiktok", handle: "beta_tt", status: "active" },
    { brandId: "delta", platform: "instagram", handle: "delta_de", status: "planned" },
    { brandId: "solo", platform: "facebook", handle: "solo_fb", status: "active" },
  ]);
  const [link] = await insertReturning(db, schema.integrations, {
    provider: "meta",
    label: "Synthetic publication target",
  });
  for (const row of rows)
    await db
      .update(schema.socialAccounts)
      .set({ externalId: `fixture-${row.id}`, integrationId: link.id, isProfessional: true })
      .where(eq(schema.socialAccounts.id, row.id));
  accounts = Object.fromEntries(rows.map((r) => [r.handle, r.id]));
  await db.insert(schema.brandKits).values({
    brandId: "alpha",
    ctas: ["Save this for your move"],
    hashtags: ["alphabrand"],
    higgsfield: { elementIds: ["el-123"], characterIds: [], styleNotes: "Warm film look" },
    colors: [{ name: "Navy", hex: "#001f3f" }],
  });
  await db.insert(schema.facts).values([
    {
      familyId: FAMILY,
      externalKey: "timeline",
      language: "en",
      verified: true,
      topic: "timeline",
      claim: "EN-FACT complete files take about 45 days",
      sourceUrl: "https://example.gov.py/plazos",
    },
    {
      familyId: FAMILY,
      externalKey: "timeline",
      language: "es",
      verified: false,
      topic: "timeline",
      claim: "ES-FACT los expedientes completos tardan unos 45 días",
    },
  ]);
  await db.insert(schema.lessons).values([
    { text: "ALPHA-HOOK contradict a number", kind: "hook", brandId: "alpha" },
    { text: "FAMILY-CTA comment a keyword", kind: "cta", familyId: FAMILY },
    { text: "OTHER-BRAND hook", kind: "hook", brandId: "solo" },
    { text: "NOT-A-POST-LESSON title", kind: "title_pattern", brandId: "alpha" },
  ]);
  owner = { cookie: (await signIn("owner")).cookie };
});

after(async () => {
  delete process.env.MONTHLY_SPEND_CAP_USD;
  delete process.env.AI_PROVIDER;
  await teardown();
});

type Handler = (
  request: Request,
  context: { params: Promise<{ id: string }> },
) => Promise<Response>;
/** A `[id]` route as `callRoute` takes it. */
function withId(handler: Handler, id: number) {
  return (request: Request) => handler(request, { params: Promise.resolve({ id: String(id) }) });
}

function promptOf(call: { params: unknown }): string {
  return (call.params as { contents: string }).contents;
}

const postCost = (queries: number) =>
  messageCostUsd(readUsage({ usageMetadata: USAGE.post } as never), queries);

async function anIdea(): Promise<number> {
  const [idea] = await insertReturning(db, schema.ideas, {
    brandId: "alpha",
    title: "IDEA-TITLE the 45-day timeline",
    angle: "Everyone still quotes 90 days.",
    format: "carousel",
    platform: "instagram",
    draftCopy: "IDEA-COPY 45 days, not 90.",
    citations: [{ claim: "45 days", sources: ["https://example.gov.py/plazos"] }],
  });
  return idea.id;
}

type PostJson = {
  id: number;
  status: string;
  format: string;
  body: PostDraft;
  caption: string;
  parentPostId: number | null;
  accountId: number;
  publishedAt: string | null;
};

async function draftFromIdea(): Promise<PostJson> {
  const response = await callRoute(
    createPost,
    jsonPost("/api/posts", { accountId: accounts.alpha_en, ideaId: await anIdea() }, owner),
  );
  assert.equal(response.status, 201);
  return ((await response.json()) as { post: PostJson }).post;
}

// ---------------------------------------------------------------------------
// drafting
// ---------------------------------------------------------------------------

test("a post drafted from an idea: a valid carousel, the account's context in the prompt, billed ungrounded", async () => {
  const fake = fakeGeminiClient();
  const post = await draftFromIdea();

  assert.equal(post.status, "drafting");
  assert.equal(post.format, "carousel", "the idea's format");
  assert.ok(validatePostDraft(post.body).ok, "the stored body passes the contract");
  assert.equal(post.body.language, "en");
  assert.equal(post.body.slides?.length, 3);
  assert.equal(post.body.shots, undefined, "lists the format does not use are dropped");
  assert.deepEqual(post.body.hashtags, ["paraguay", "residency", "ExpatLife"]);
  assert.match(post.caption, /#paraguay #residency #ExpatLife$/);
  assert.equal(post.body.sources.length, 1, "the source without a URL is dropped …");
  assert.match(post.body.notes ?? "", /UNSOURCED — verify or cut: Four documents/, "… and said");

  const [call] = fake.callsOf("generateContent");
  assert.equal(call.responseKind, "post");
  assert.equal(call.groundingQueries, 0, "a post from an idea is not grounded");
  const prompt = promptOf(call);
  for (const expected of [
    /IDEA-TITLE/,
    /IDEA-COPY/,
    /@alpha_en on instagram/,
    /Language: English/,
    /Voice of alpha/,
    /Warm film look/,
    /alphabrand/,
    /EN-FACT/,
    /ALPHA-HOOK/,
    /FAMILY-CTA/,
    /PLAYBOOK/,
    /STYLE GUIDE/,
  ]) {
    assert.match(prompt, expected);
  }
  assert.doesNotMatch(prompt, /ES-FACT/, "family facts in the account's language only");
  assert.doesNotMatch(prompt, /OTHER-BRAND|NOT-A-POST-LESSON/);

  assert.equal((await monthToDateUsd()).toFixed(6), postCost(0).toFixed(6));
});

test("a post from a topic is grounded and billed per search; a TikTok account defaults to a reel", async () => {
  await db
    .insert(schema.socialAccounts)
    .values({ brandId: "alpha", platform: "tiktok", handle: "alpha_tt", status: "active" });
  const [tt] = await db
    .select()
    .from(schema.socialAccounts)
    .where(eq(schema.socialAccounts.handle, "alpha_tt"));
  const fake = fakeGeminiClient();

  const response = await callRoute(
    createPost,
    jsonPost("/api/posts", { accountId: tt.id, topic: "Apostilles" }, owner),
  );
  assert.equal(response.status, 201);
  const { post, costUsd } = (await response.json()) as { post: PostJson; costUsd: number };
  assert.equal(post.format, "reel");
  assert.equal(post.body.shots?.length, 2);
  assert.equal(post.body.slides, undefined);

  const [call] = fake.callsOf("generateContent");
  assert.equal(call.groundingQueries, WEB_SEARCH_QUERIES.length);
  assert.match(promptOf(call), /TOPIC: Apostilles/);
  assert.equal(costUsd.toFixed(6), postCost(WEB_SEARCH_QUERIES.length).toFixed(6));
  assert.equal((await monthToDateUsd()).toFixed(6), costUsd.toFixed(6));
});

test("drafting is owner-only and refuses bad input before any call", async () => {
  const employee = { cookie: (await signIn("employee")).cookie };
  const fake = fakeGeminiClient();
  const payload = { accountId: accounts.alpha_en, topic: "t" };

  const anon = await callRoute(createPost, jsonPost("/api/posts", payload));
  assert.equal(anon.status, 401);
  const denied = await callRoute(createPost, jsonPost("/api/posts", payload, employee));
  assert.equal(denied.status, 403);
  assert.match(((await denied.json()) as { error: string }).error, /owner's to spend/);

  for (const [body, status] of [
    [{ topic: "t" }, 400],
    [{ accountId: accounts.alpha_en }, 400],
    [{ accountId: accounts.alpha_en, topic: "t", ideaId: 1 }, 400],
    [{ accountId: accounts.alpha_en, topic: "t", format: "podcast" }, 400],
    [{ accountId: 9999, topic: "t" }, 404],
    [{ accountId: accounts.alpha_en, ideaId: 9999 }, 404],
  ] as const) {
    const response = await callRoute(createPost, jsonPost("/api/posts", body, owner));
    assert.equal(response.status, status, JSON.stringify(body));
  }
  assert.equal(fake.calls.length, 0);
  assert.equal(await monthToDateUsd(), 0);
});

test("a model answer that fails the contract is a 502 with the errors, billed, and saves nothing", async () => {
  const fake = fakeGeminiClient();
  const payload = structuredClone(PAYLOADS.post) as { slides: unknown[] };
  payload.slides = payload.slides.slice(0, 1); // a one-slide carousel
  fake.controls.payloadOverrides.set("post", payload);

  const response = await callRoute(
    createPost,
    jsonPost("/api/posts", { accountId: accounts.alpha_en, ideaId: await anIdea() }, owner),
  );
  assert.equal(response.status, 502);
  const body = (await response.json()) as { error: string; errors: string[] };
  assert.match(body.error, /post contract/);
  assert.ok(
    body.errors.some((e) => /body\.slides must have at least 2 items/.test(e)),
    body.errors.join("; "),
  );
  assert.equal((await db.select().from(schema.posts)).length, 0);
  assert.equal(
    (await monthToDateUsd()).toFixed(6),
    postCost(0).toFixed(6),
    "the tokens were spent",
  );
});

test("a spend cap of 0 answers 429 before the model is called", async () => {
  process.env.MONTHLY_SPEND_CAP_USD = "0";
  const fake = fakeGeminiClient();
  const response = await callRoute(
    createPost,
    jsonPost("/api/posts", { accountId: accounts.alpha_en, topic: "t" }, owner),
  );
  assert.equal(response.status, 429);
  assert.equal(fake.calls.length, 0);
});

// ---------------------------------------------------------------------------
// adapting
// ---------------------------------------------------------------------------

test("adapt creates one sibling per active same-platform account in the family, and a re-run skips them", async () => {
  const source = await draftFromIdea();
  const fake = fakeGeminiClient();
  fake.reset();

  const response = await callRoute(
    withId(adapt, source.id),
    jsonPost(`/api/posts/${source.id}/adapt`, {}, owner),
  );
  assert.equal(response.status, 201);
  const result = (await response.json()) as {
    created: PostJson[];
    skipped: unknown[];
    costUsd: number;
  };
  assert.deepEqual(
    result.created.map((p) => p.accountId).sort(),
    [accounts.beta_es, accounts.gamma_pt].sort(),
  );
  for (const sibling of result.created) {
    assert.equal(sibling.parentPostId, source.id);
    assert.equal(sibling.status, "drafting");
    assert.ok(validatePostDraft(sibling.body).ok);
  }
  assert.deepEqual(result.created.map((p) => p.body.language).sort(), ["es", "pt-BR"]);

  const calls = fake.callsOf("generateContent");
  assert.equal(calls.length, 2);
  assert.ok(
    calls.every((c) => c.groundingQueries === 0),
    "adapting is not grounded",
  );
  const betaPrompt = calls.map(promptOf).find((p) => p.includes("@beta_es"))!;
  assert.match(betaPrompt, /SOURCE POST/);
  assert.match(betaPrompt, /UNVERIFIED — say it only in this hedged wording\] ES-FACT/);
  assert.doesNotMatch(betaPrompt, /EN-FACT/);
  assert.equal(result.costUsd.toFixed(6), (2 * postCost(0)).toFixed(6));

  // Again, from a child: the whole tree is covered, nothing new, nothing spent.
  fake.reset();
  const again = await callRoute(
    withId(adapt, result.created[0].id),
    jsonPost(`/api/posts/${result.created[0].id}/adapt`, {}, owner),
  );
  assert.equal(again.status, 200);
  const second = (await again.json()) as { created: unknown[]; skipped: { accountId: number }[] };
  assert.equal(second.created.length, 0);
  assert.deepEqual(
    second.skipped.map((s) => s.accountId).sort(),
    [accounts.alpha_en, accounts.gamma_pt].sort(),
  );
  assert.equal(fake.calls.length, 0);
});

test("adapt is owner-only; a post with no family has nothing to adapt to", async () => {
  const source = await draftFromIdea();
  const employee = { cookie: (await signIn("employee")).cookie };
  const denied = await callRoute(
    withId(adapt, source.id),
    jsonPost(`/api/posts/${source.id}/adapt`, {}, employee),
  );
  assert.equal(denied.status, 403);

  const [solo] = await insertReturning(db, schema.posts, {
    accountId: accounts.solo_fb,
    brandId: "solo",
    format: "carousel",
    status: "drafting",
    body: post().body,
  });
  const none = await callRoute(
    withId(adapt, solo.id),
    jsonPost(`/api/posts/${solo.id}/adapt`, {}, owner),
  );
  assert.equal(none.status, 200);
  assert.deepEqual(((await none.json()) as { created: unknown[] }).created, []);

  const missing = await callRoute(
    withId(adapt, 9999),
    jsonPost("/api/posts/9999/adapt", {}, owner),
  );
  assert.equal(missing.status, 404);
});

/** A stored-looking carousel body, for rows inserted directly. */
function post(): { body: PostDraft } {
  return {
    body: {
      version: 1,
      format: "carousel",
      language: "en",
      hook: "h",
      caption: "c",
      cta: "cta",
      hashtags: [],
      engagement: { mechanic: "save", detail: "d" },
      slides: [
        { n: 1, headline: "a", body: "", visual: { prompt: "p", textOverlay: "" } },
        { n: 2, headline: "b", body: "", visual: { prompt: "p", textOverlay: "" } },
      ],
      sources: [],
    },
  };
}

// ---------------------------------------------------------------------------
// regenerate, patch, export
// ---------------------------------------------------------------------------

test("regenerating one section replaces it and keeps the owner's edits elsewhere", async () => {
  const source = await draftFromIdea();
  const edited = { ...source.body, hook: "OLD HOOK", caption: "MY OWN CAPTION" };
  const patched = await callRoute(
    withId(patchPost, source.id),
    jsonPost(`/api/posts/${source.id}`, { body: edited }, owner),
  );
  assert.equal(patched.status, 200);

  const response = await callRoute(
    withId(regenerate, source.id),
    jsonPost(`/api/posts/${source.id}/regenerate`, { section: "hook" }, owner),
  );
  assert.equal(response.status, 200);
  const { post: saved } = (await response.json()) as { post: PostJson };
  assert.equal(saved.body.hook, (PAYLOADS.post as { hook: string }).hook);
  assert.equal(saved.body.caption, "MY OWN CAPTION");
  assert.match(
    saved.caption,
    /^MY OWN CAPTION/,
    "the posted caption is not reset by a hook rewrite",
  );
  const call = fakeGeminiClient().callsOf("generateContent").at(-1)!;
  assert.match(promptOf(call), /Rewrite ONLY "hook"/);
  assert.match(promptOf(call), /OLD HOOK/);

  const bad = await callRoute(
    withId(regenerate, source.id),
    jsonPost(`/api/posts/${source.id}/regenerate`, { section: "shots" }, owner),
  );
  assert.equal(bad.status, 400, "a carousel has no shots");
  const unknown = await callRoute(
    withId(regenerate, source.id),
    jsonPost(`/api/posts/${source.id}/regenerate`, { section: "everything" }, owner),
  );
  assert.equal(unknown.status, 400);
});

function patch(id: number, body: unknown, headers = owner): Promise<Response> {
  return callRoute(
    withId(patchPost, id),
    new Request(`http://localhost/api/posts/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );
}

test("PATCH validates the body, enforces legal status moves and stamps publishing", async () => {
  const source = await draftFromIdea();

  const anon = await patch(source.id, { title: "x" }, {});
  assert.equal(anon.status, 401);

  const invalid = await patch(source.id, { body: { ...source.body, slides: [] } });
  assert.equal(invalid.status, 400);
  const invalidBody = (await invalid.json()) as { errors: string[] };
  assert.ok(invalidBody.errors.some((e) => /body\.slides/.test(e)));

  const skip = await patch(source.id, { status: "published" });
  assert.equal(skip.status, 409, "drafting cannot jump to published");

  assert.equal((await patch(source.id, { status: "ready" })).status, 200);
  const noDate = await patch(source.id, { status: "scheduled", title: "NOT SAVED" });
  assert.equal(noDate.status, 409);
  assert.match(((await noDate.json()) as { error: string }).error, /scheduledFor/);
  const [unchanged] = await db.select().from(schema.posts).where(eq(schema.posts.id, source.id));
  assert.notEqual(unchanged.title, "NOT SAVED", "a refused move writes nothing");

  const scheduled = await patch(source.id, {
    scheduledFor: "2026-10-01T09:00:00.000Z",
    status: "scheduled",
    caption: "Final caption",
  });
  assert.equal(scheduled.status, 200);
  const s = ((await scheduled.json()) as { post: PostJson & { scheduledFor: string } }).post;
  assert.equal(s.status, "scheduled");
  assert.equal(s.caption, "Final caption");

  const published = await patch(source.id, {
    status: "published",
    permalink: "https://instagram.com/p/abc",
  });
  const p = ((await published.json()) as { post: PostJson }).post;
  assert.equal(p.status, "published");
  assert.ok(p.publishedAt, "published_at is stamped");

  assert.equal((await patch(source.id, { permalink: "not a url" })).status, 400);
  assert.equal((await patch(source.id, { status: "nope" })).status, 400);
  assert.equal((await patch(9999, { title: "x" })).status, 404);
});

test("export: the brief lists every visual with its target file and the kit; the pack lists files in order", async () => {
  const source = await draftFromIdea();
  const get = (query: string, headers = owner) =>
    callRoute(
      withId(exportPost, source.id),
      new Request(`http://localhost/api/posts/${source.id}/export?${query}`, { headers }),
    );

  assert.equal((await get("format=brief", {})).status, 401);
  assert.equal((await get("format=zip")).status, 400);

  const md = await get("format=brief");
  assert.equal(md.status, 200);
  assert.match(md.headers.get("content-type") ?? "", /markdown/);
  const markdown = await md.text();
  assert.match(markdown, /# Generation brief/);
  assert.match(markdown, /Higgsfield elements: el-123/);

  const brief = (await (await get("format=brief&as=json")).json()) as PostBrief;
  assert.equal(brief.visuals.length, 3);
  assert.match(brief.folder, new RegExp(`^alpha/alpha-en/\\d{4}-\\d{2}/${source.id}-`));
  assert.ok(brief.visuals.every((v) => v.targetFile.startsWith(`${brief.folder}/0`)));
  assert.equal(brief.visuals[0].role, "cover");
  assert.equal(brief.visuals[0].aspectRatio, "4:5");
  assert.deepEqual(brief.kit?.higgsfieldElementIds, ["el-123"]);

  const [asset] = await insertReturning(db, schema.assets, {
    brandId: "alpha",
    kind: "image",
    mime: "image/png",
    bytes: 10,
    sha256: "a".repeat(64),
    localPath: `${brief.folder}/01-cover.png`,
    source: "higgsfield",
  });
  await db.insert(schema.postAssets).values({ postId: source.id, assetId: asset.id, position: 1 });
  const pack = (await (await get("format=pack&as=json")).json()) as PostPack;
  assert.equal(pack.caption, source.caption);
  assert.deepEqual(
    pack.files.map((f) => [f.position, f.url, f.fileName]),
    [[1, `/api/media/asset/${asset.id}`, "01-cover.png"]],
  );
  assert.match(await (await get("format=pack")).text(), /## Files, in order/);
});

// ---------------------------------------------------------------------------
// topic-first /api/generate, clip transcription
// ---------------------------------------------------------------------------

test("/api/generate takes an optional topic into the grounded prompt", async () => {
  const fake = fakeGeminiClient();
  const bad = await callRoute(
    generate,
    jsonPost("/api/generate", { brandId: "alpha", topic: 3 }, owner),
  );
  assert.equal(bad.status, 400);
  assert.equal(fake.calls.length, 0);

  const response = await callRoute(
    generate,
    jsonPost("/api/generate", { brandId: "alpha", topic: "Apostille backlog" }, owner),
  );
  assert.equal(response.status, 200);
  const [call] = fake.callsOf("generateContentStream");
  assert.match(promptOf(call), /TOPIC — the owner picked this topic[\s\S]*Apostille backlog/);
  assert.equal(call.groundingQueries, WEB_SEARCH_QUERIES.length, "still grounded");
});

test("transcribeClip sends the media to Gemini Flash-Lite even in CLI mode, and bills it", async () => {
  process.env.AI_PROVIDER = "claude-cli";
  const dir = await mkdtemp(path.join(tmpdir(), "clip-"));
  try {
    const file = path.join(dir, "reel.mp4");
    await writeFile(file, Buffer.from("not really a video"));
    const fake = fakeGeminiClient();

    const result = await transcribeClip({ path: file, mime: "video/mp4", durationSec: 40 });
    assert.match(result.transcript, /cuarenta y cinco días/);
    assert.equal(result.claims.length, 2);
    assert.deepEqual(result.claims[0], {
      claim: "Paraguayan residency takes 45 days.",
      timestampSec: 4,
    });

    const [call] = fake.callsOf("generateContent");
    assert.equal(call.responseKind, "transcript");
    assert.equal(call.model, "gemini-3.1-flash-lite");
    const parts = (call.params as { contents: { parts: { inlineData?: { data: string } }[] }[] })
      .contents[0].parts;
    assert.equal(Buffer.from(parts[0].inlineData!.data, "base64").toString(), "not really a video");
    const expected = messageCostUsd(
      readUsage({ usageMetadata: USAGE.transcript } as never),
      0,
      "gemini-3.1-flash-lite",
    );
    assert.equal(result.costUsd.toFixed(6), expected.toFixed(6));
    assert.equal((await monthToDateUsd()).toFixed(6), expected.toFixed(6));

    // A URL goes as a file URI and still gets a transcript, not the analysis fallback.
    const byUrl = await transcribeClip({ url: "https://www.youtube.com/shorts/abc" });
    assert.match(byUrl.summary, /creator claims/);

    await assert.rejects(
      transcribeClip({ path: file, durationSec: TRANSCRIBE_MAX_SECONDS + 1 }),
      TranscribeRefusedError,
    );
    assert.equal(fake.callsOf("generateContent").length, 2, "a refusal makes no call");
  } finally {
    delete process.env.AI_PROVIDER;
    await rm(dir, { recursive: true, force: true });
  }
});
