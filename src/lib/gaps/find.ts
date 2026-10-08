import { insertReturning, updateReturning } from "@/db/mutations";
import "server-only";
import { and, desc, eq, gte, inArray, ne, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  audienceQuestions,
  competitorPosts,
  competitorReports,
  contentGaps,
  FORMATS,
  ideas,
  posts,
  scripts,
  socialCompetitors,
  type ContentGap,
  type Format,
} from "@/db/schema";
import { structuredJson } from "@/lib/ai";
import { costUsdAtRates, ideationRates } from "@/lib/analysis/pricing";
import { getBrand } from "@/lib/bridge";
import type { CompetitorReport } from "@/lib/studio/types";

import {
  buildGapPrompt,
  GAPS_JSON_SCHEMA,
  GAPS_SYSTEM,
  gapIdeaCopy,
  REF_PREFIX,
  validateGaps,
  type GapInput,
  type GapInputs,
} from "./validate";

/**
 * Finding content gaps for one brand (build 4 §3.G): gather what competitors
 * post, what reports found, what the audience asks and what the brand already
 * covers; ask the model for 5–10 gaps; keep the ones whose evidence checks out.
 */

export type ModelCall = typeof structuredJson;

const MODEL = process.env.GEMINI_MODEL ?? "gemini-3.7-flash";
const GAPS_MAX_OUTPUT_TOKENS = 4_000;
const GAPS_THINKING_TOKENS = 4_000;
/** ~150 inputs at ~60 tokens each, plus instructions; rounded up. */
const GAPS_PROMPT_TOKENS = 12_000;

/** The worst case one run can bill — shown on the page before running. */
export function estimateGapsCostUsd(): number {
  return costUsdAtRates(ideationRates(MODEL), {
    inputTokens: GAPS_PROMPT_TOKENS,
    outputTokens: GAPS_MAX_OUTPUT_TOKENS + GAPS_THINKING_TOKENS,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  });
}

export const GAP_LOOKBACK_DAYS = 90;
const MAX_COMPETITOR_POSTS = 60;
const MAX_REPORTS = 3;
const MAX_QUESTIONS = 40;
const MAX_OWN = 80;

export class GapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GapError";
  }
}

const ref = (kind: keyof typeof REF_PREFIX, id: number | string) => `${REF_PREFIX[kind]}:${id}`;

/** Everything the prompt sees for one brand. Free: no model call. */
export async function gatherGapInputs(
  brandId: string,
  options: { now?: Date } = {},
): Promise<GapInputs> {
  const brand = await getBrand(brandId);
  if (!brand) throw new GapError("No such brand.");
  const since = new Date((options.now ?? new Date()).getTime() - GAP_LOOKBACK_DAYS * 86_400_000);

  const competitorIds = (
    await db
      .select({ id: socialCompetitors.id })
      .from(socialCompetitors)
      .where(eq(socialCompetitors.brandId, brandId))
  ).map((r) => r.id);

  const [cps, reports, questions, ownPosts, ownIdeas, ownScripts] = await Promise.all([
    competitorIds.length
      ? db
          .select({
            id: competitorPosts.id,
            caption: competitorPosts.caption,
            mediaType: competitorPosts.mediaType,
            likes: competitorPosts.likes,
            comments: competitorPosts.comments,
          })
          .from(competitorPosts)
          .where(
            and(
              inArray(competitorPosts.competitorId, competitorIds),
              gte(competitorPosts.postedAt, since),
            ),
          )
          .orderBy(
            sql`coalesce(${competitorPosts.likes}, 0) + coalesce(${competitorPosts.comments}, 0) desc`,
            desc(competitorPosts.id),
          )
          .limit(MAX_COMPETITOR_POSTS)
      : [],
    db
      .select({ id: competitorReports.id, body: competitorReports.body })
      .from(competitorReports)
      .where(eq(competitorReports.brandId, brandId))
      .orderBy(desc(competitorReports.createdAt), desc(competitorReports.id))
      .limit(MAX_REPORTS),
    db
      .select({
        id: audienceQuestions.id,
        question: audienceQuestions.question,
        askCount: audienceQuestions.askCount,
      })
      .from(audienceQuestions)
      .where(and(eq(audienceQuestions.brandId, brandId), ne(audienceQuestions.status, "dismissed")))
      .orderBy(desc(audienceQuestions.askCount), desc(audienceQuestions.id))
      .limit(MAX_QUESTIONS),
    db
      .select({ id: posts.id, title: posts.title, caption: posts.caption, body: posts.body })
      .from(posts)
      .where(and(eq(posts.brandId, brandId), eq(posts.status, "published")))
      .orderBy(desc(posts.publishedAt), desc(posts.id))
      .limit(MAX_OWN),
    db
      .select({ id: ideas.id, title: ideas.title })
      .from(ideas)
      .where(and(eq(ideas.brandId, brandId), ne(ideas.status, "rejected")))
      .orderBy(desc(ideas.createdAt), desc(ideas.id))
      .limit(MAX_OWN),
    db
      .select({ id: scripts.id, title: scripts.title })
      .from(scripts)
      .where(eq(scripts.brandId, brandId))
      .orderBy(desc(scripts.updatedAt), desc(scripts.id))
      .limit(MAX_OWN),
  ]);

  const market: GapInput[] = [];
  for (const p of cps) {
    if (!p.caption?.trim()) continue;
    market.push({
      kind: "competitor_post",
      ref: ref("competitor_post", p.id),
      text: `${p.mediaType ?? "post"}, ${p.likes ?? 0} likes, ${p.comments ?? 0} comments: ${p.caption}`,
    });
  }
  for (const r of reports) {
    const body = r.body as Partial<CompetitorReport> | null;
    const findings = [
      ...(body?.patterns ?? []),
      ...(body?.winners ?? []).map((w) => `${w.title} — ${w.whyItWorked}`),
      ...(body?.ideas ?? []).map((i) => `${i.title}: ${i.angle}`),
    ].filter((s) => typeof s === "string" && s.trim());
    // One ref per report: the findings joined, so the evidence points at the report.
    if (findings.length) {
      market.push({ kind: "report", ref: ref("report", r.id), text: findings.join(" | ") });
    }
  }
  for (const q of questions) {
    market.push({
      kind: "question",
      ref: ref("question", q.id),
      text: `asked ${q.askCount}×: ${q.question}`,
    });
  }

  const own: GapInput[] = [];
  for (const p of ownPosts) {
    const hook = (p.body as { hook?: unknown } | null)?.hook;
    const text = [typeof hook === "string" ? hook : "", p.title, p.caption ?? ""]
      .filter((s) => s.trim())
      .join(" — ");
    if (text) own.push({ kind: "own_post", ref: ref("own_post", p.id), text });
  }
  for (const i of ownIdeas) own.push({ kind: "idea", ref: ref("idea", i.id), text: i.title });
  for (const s of ownScripts) own.push({ kind: "script", ref: ref("script", s.id), text: s.title });

  return {
    brand: {
      id: brand.id,
      name: brand.name,
      niche: brand.niche,
      market: brand.market,
      language: brand.language,
    },
    market,
    own,
  };
}

export type FindGapsResult = { gaps: ContentGap[]; dropped: string[]; costUsd: number };

/** Run the model over a brand's inputs and store the gaps that check out. Spends. */
export async function findGaps(
  brandId: string,
  deps: { model?: ModelCall; now?: Date } = {},
): Promise<FindGapsResult> {
  const inputs = await gatherGapInputs(brandId, { now: deps.now });
  if (inputs.market.length === 0) {
    throw new GapError(
      "Nothing to compare yet: add competitors (Research → Instagram), a competitor report or audience questions first.",
    );
  }
  const model = deps.model ?? structuredJson;
  const { text, costUsd } = await model({
    system: GAPS_SYSTEM,
    prompt: buildGapPrompt(inputs),
    schema: GAPS_JSON_SCHEMA,
    webSearch: false,
    estimateUsd: estimateGapsCostUsd(),
    maxOutputTokens: GAPS_MAX_OUTPUT_TOKENS,
    thinkingLow: true,
  });
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new GapError("The model did not return parseable gaps. Try again.");
  }
  const { gaps, dropped } = validateGaps(raw, inputs);
  if (gaps.length === 0) {
    throw new GapError(
      `The model's gaps did not check out against the inputs (${dropped.join("; ")}).`,
    );
  }
  const rows = await insertReturning(
    db,
    contentGaps,
    gaps.map((g) => ({ brandId, ...g })),
  );
  return { gaps: rows, dropped, costUsd };
}

/** A brand's gaps by status, best score first. */
export async function listGaps(
  brandId: string,
  statuses: ContentGap["status"][] = ["new", "planned"],
): Promise<ContentGap[]> {
  return db
    .select()
    .from(contentGaps)
    .where(and(eq(contentGaps.brandId, brandId), inArray(contentGaps.status, statuses)))
    .orderBy(
      sql`${contentGaps.status} = 'planned'`,
      desc(contentGaps.score),
      desc(contentGaps.createdAt),
      desc(contentGaps.id),
    );
}

function ideaFormat(platform: string): Format {
  const f: Format = platform === "tiktok" || platform === "youtube" ? "reel" : "carousel";
  return FORMATS.includes(f) ? f : "carousel";
}

/**
 * "Make idea": a `proposed` idea for the brand built from the gap, the way
 * promoted ideas are inserted, and the gap marked `planned` with its id.
 * Idempotent: a gap that already has an idea returns that idea's id.
 */
export async function makeIdeaFromGap(
  gapId: number,
): Promise<{ ideaId: number; created: boolean }> {
  const [gap] = await db.select().from(contentGaps).where(eq(contentGaps.id, gapId)).limit(1);
  if (!gap) throw new GapError("No such gap.");
  if (gap.ideaId) return { ideaId: gap.ideaId, created: false };
  const brand = await getBrand(gap.brandId);
  if (!brand) throw new GapError("The gap's brand no longer exists.");
  const platform = brand.platforms[0] ?? "instagram";
  const copy = gapIdeaCopy(gap);

  return db.transaction(async (tx) => {
    const [idea] = await insertReturning(
      tx,
      ideas,
      {
        brandId: brand.id,
        title: copy.title,
        angle: copy.angle,
        format: ideaFormat(platform),
        platform,
        draftCopy: copy.draftCopy,
        status: "proposed",
      },
      { id: ideas.id },
    );
    await tx
      .update(contentGaps)
      .set({ status: "planned", ideaId: idea.id })
      .where(eq(contentGaps.id, gapId));
    return { ideaId: idea.id, created: true };
  });
}

export async function setGapStatus(gapId: number, status: ContentGap["status"]): Promise<void> {
  const rows = await updateReturning(db, contentGaps, { status }, eq(contentGaps.id, gapId), {
    id: contentGaps.id,
  });
  if (rows.length === 0) throw new GapError("No such gap.");
}

/** Links for evidence refs: a competitor post's permalink, our own post's page. */
export async function evidenceLinks(gaps: ContentGap[]): Promise<Map<string, string>> {
  const links = new Map<string, string>();
  const cpIds: number[] = [];
  for (const g of gaps) {
    for (const e of g.evidence) {
      const id = Number(e.ref.split(":")[1]);
      if (!Number.isInteger(id) || id <= 0) continue;
      if (e.kind === "competitor_post") cpIds.push(id);
      if (e.kind === "own_post") links.set(e.ref, `/posts/${id}`);
    }
  }
  if (cpIds.length) {
    const rows = await db
      .select({ id: competitorPosts.id, permalink: competitorPosts.permalink })
      .from(competitorPosts)
      .where(inArray(competitorPosts.id, [...new Set(cpIds)]));
    for (const r of rows) if (r.permalink) links.set(ref("competitor_post", r.id), r.permalink);
  }
  return links;
}
