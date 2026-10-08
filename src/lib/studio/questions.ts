import "server-only";
import { structuredJson } from "@/lib/ai";
import { costUsdAtRates, ideationRates } from "@/lib/analysis/pricing";
import { getBrand } from "@/lib/bridge/brands";
import { upsertAudienceQuestions } from "@/lib/bridge/questions";
import { topOutliersForBrand } from "@/lib/bridge/research";
import { YouTubeCommentsClient } from "@/lib/youtube/comments";
import {
  buildQuestionsPrompt,
  isLikelyQuestion,
  MAX_COMMENTS_TO_CLUSTER,
  QUESTIONS_JSON_SCHEMA,
  QUESTIONS_SYSTEM_PROMPT,
  validateQuestionClusters,
  type CommentForClustering,
} from "./question-filter";

/**
 * Comment mining (build 2b, idea 2): the top outliers' most relevant comments
 * → the ones that look like questions → one `structuredJson` call clusters them
 * → upserted into `audience_questions` by normalised text. The YouTube half is
 * free (1 quota unit per video); the model half runs under the spend cap, or on
 * the logged-in CLI at $0 (§1.38).
 */

const QUESTIONS_MAX_OUTPUT_TOKENS = 6_000;
const QUESTIONS_THINKING_TOKENS = 2_000;
/** 400 comments × ≤ 400 characters ≈ 40k tokens at worst, plus the prompt. */
const QUESTIONS_PROMPT_TOKENS = 42_000;

const studioModel = () => process.env.GEMINI_MODEL ?? "gemini-3.7-flash";

export function estimateQuestionsCostUsd(model: string = studioModel()): number {
  return costUsdAtRates(ideationRates(model), {
    inputTokens: QUESTIONS_PROMPT_TOKENS,
    outputTokens: QUESTIONS_MAX_OUTPUT_TOKENS + QUESTIONS_THINKING_TOKENS,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  });
}

export type MineQuestionsResult =
  | {
      ok: true;
      videos: number;
      comments: number;
      questionComments: number;
      inserted: number;
      updated: number;
      costUsd: number;
    }
  | { ok: false; reason: "no_brand" | "no_videos" | "no_questions"; message: string };

export async function mineQuestions(
  brandId: string,
  opts: { videos?: number; days?: number; client?: YouTubeCommentsClient } = {},
): Promise<MineQuestionsResult> {
  const brand = await getBrand(brandId);
  if (!brand) return { ok: false, reason: "no_brand", message: `No brand "${brandId}".` };

  const limit = Math.min(50, Math.max(1, Math.floor(opts.videos ?? 10)));
  const top = await topOutliersForBrand(brandId, { days: opts.days ?? 90, limit });
  if (top.length === 0) {
    return {
      ok: false,
      reason: "no_videos",
      message: `No scored competitor videos for ${brand.name} yet.`,
    };
  }

  const client = opts.client ?? new YouTubeCommentsClient();
  let comments = 0;
  const questions: CommentForClustering[] = [];
  for (const video of top) {
    const page = await client.topComments(video.youtubeId);
    comments += page.length;
    for (const c of page)
      if (isLikelyQuestion(c.text)) questions.push({ videoId: video.videoId, text: c.text });
  }
  if (questions.length === 0) {
    return {
      ok: false,
      reason: "no_questions",
      message: `Read ${comments} comments on ${top.length} videos; none looked like a question.`,
    };
  }

  const batch = interleaveByVideo(questions).slice(0, MAX_COMMENTS_TO_CLUSTER);
  const { text, costUsd, finishReason } = await structuredJson({
    system: QUESTIONS_SYSTEM_PROMPT,
    prompt: buildQuestionsPrompt(brand, batch),
    schema: QUESTIONS_JSON_SCHEMA,
    webSearch: false,
    estimateUsd: estimateQuestionsCostUsd(),
    maxOutputTokens: QUESTIONS_MAX_OUTPUT_TOKENS,
    thinkingLow: true,
  });

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(
      `The model didn't return parseable questions (finish reason: ${finishReason ?? "unknown"}). Try again.`,
    );
  }
  const clusters = validateQuestionClusters(
    raw,
    top.map((v) => v.videoId),
  );
  const { inserted, updated } = await upsertAudienceQuestions(brandId, clusters);
  return {
    ok: true,
    videos: top.length,
    comments,
    questionComments: questions.length,
    inserted,
    updated,
    costUsd,
  };
}

/**
 * Round-robin across videos, each video's comments in the API's relevance
 * order — so the cap trims every video's weakest comments, not the last
 * videos entirely.
 */
function interleaveByVideo(comments: CommentForClustering[]): CommentForClustering[] {
  const queues = new Map<number, CommentForClustering[]>();
  for (const c of comments) queues.set(c.videoId, [...(queues.get(c.videoId) ?? []), c]);
  const out: CommentForClustering[] = [];
  for (let i = 0; out.length < comments.length; i++) {
    for (const q of queues.values()) if (q[i]) out.push(q[i]);
  }
  return out;
}
