import { upsertReturning } from "@/db/mutations";
import type { GenerateContentResponse } from "@google/genai";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { analyses, outlines, videos, type Outline } from "@/db/schema";
import { gemini, readUsage, responseText, MAX_OUTPUT_TOKENS, THINKING_LEVEL } from "./run";
import type { OutlinePayload } from "./contract";
import {
  buildOutlineUserPrompt,
  OUTLINE_JSON_SCHEMA,
  OUTLINE_SYSTEM_PROMPT,
} from "./outline-prompt";
import { parseOutlineResponse } from "./outline-parse";
import { DEFAULT_MODEL, estimateCostUsd, toCostString, type AnalysisModel } from "./pricing";
import { dispatchSpend, recordSpend, withSpendCap } from "@/lib/spend";

/**
 * PR-13: not yet built, per docs/HANDOFF-SONNET.md §3. Same shape as the
 * analysis pipeline (run.ts) — one Gemini call, structured outputs,
 * defensive parse, record cost via recordSpend — but writes to `outlines`,
 * unique on (analysis_id, idea_index): regenerating replaces, not accumulates.
 */

/** Fixed estimate — outline input is a few sentences, not a transcript. */
const ESTIMATED_INPUT_TOKENS = 400;
const ESTIMATED_OUTPUT_TOKENS = 700;

export function estimateOutlineCostUsd(model: AnalysisModel): number {
  return estimateCostUsd(model, {
    inputTokens: ESTIMATED_INPUT_TOKENS,
    outputTokens: ESTIMATED_OUTPUT_TOKENS,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  });
}

export type GenerateOutlineResult =
  | { status: "ok"; outline: Outline; payload: OutlinePayload; costUsd: number }
  | { status: "failed"; error: string };

/**
 * Persist a failed generation.
 *
 * run.ts writes a row for every failed analysis; this path used to write
 * nothing, so a paid call that failed to parse left no trace once the toast
 * disappeared — the raw response that would explain it was discarded.
 *
 * The one thing a failure must never do is destroy a good outline. The unique
 * key is (analysis_id, idea_index), so a blind upsert would replace a working
 * outline with an error row the moment a re-generate failed. Existing success
 * wins; the caller still gets the error to show.
 */
async function recordOutlineFailure(input: {
  analysisId: number;
  ideaIndex: number;
  error: string;
  rawResponse?: string;
  model: AnalysisModel;
  costUsd: number;
}): Promise<void> {
  const [existing] = await db
    .select({ status: outlines.status })
    .from(outlines)
    .where(and(eq(outlines.analysisId, input.analysisId), eq(outlines.ideaIndex, input.ideaIndex)))
    .limit(1);
  if (existing?.status === "ok") return;

  await upsertReturning(
    db,
    outlines,
    {
      analysisId: input.analysisId,
      ideaIndex: input.ideaIndex,
      status: "failed",
      error: input.error.slice(0, 1024),
      content: null,
      rawResponse: input.rawResponse ?? null,
      model: input.model,
      costUsd: toCostString(input.costUsd),
    },
    {
      target: [outlines.analysisId, outlines.ideaIndex],
      set: {
        status: "failed",
        error: input.error.slice(0, 1024),
        content: null,
        rawResponse: input.rawResponse ?? null,
        model: input.model,
        costUsd: toCostString(input.costUsd),
      },
    },
  );
}

export async function generateOutline(
  analysisId: number,
  ideaIndex: number,
  options: { model?: AnalysisModel; language?: string } = {},
): Promise<GenerateOutlineResult> {
  const model = options.model ?? DEFAULT_MODEL;

  const [analysis] = await db.select().from(analyses).where(eq(analyses.id, analysisId)).limit(1);
  if (!analysis || analysis.status !== "ok") {
    return { status: "failed", error: "Analysis not found or not successful." };
  }

  const idea = analysis.ideas?.[ideaIndex];
  if (!idea) return { status: "failed", error: "No idea at that index." };

  const [video] = await db.select().from(videos).where(eq(videos.id, analysis.videoId)).limit(1);
  if (!video) return { status: "failed", error: "Source video not found." };

  return withSpendCap(estimateOutlineCostUsd(model), runGeneration);

  async function runGeneration(): Promise<GenerateOutlineResult> {
    let response: GenerateContentResponse;
    try {
      response = await dispatchSpend(() =>
        gemini().models.generateContent({
          model,
          contents: buildOutlineUserPrompt({
            videoTitle: video.title,
            // Narrowed by the `if (!idea) return` above, but that narrowing
            // does not cross into this nested function declaration's scope.
            ideaTitle: idea!.title,
            ideaPremise: idea!.premise,
            ideaWhyNow: idea!.why_now,
            language: options.language,
          }),
          config: {
            systemInstruction: OUTLINE_SYSTEM_PROMPT,
            maxOutputTokens: MAX_OUTPUT_TOKENS,
            thinkingConfig: { thinkingLevel: THINKING_LEVEL },
            responseMimeType: "application/json",
            responseJsonSchema: OUTLINE_JSON_SCHEMA,
          },
        }),
      );
    } catch (err) {
      // No usage, so nothing was charged — but the attempt still gets a row, or
      // the next person to look wonders why this idea has no outline.
      const message = err instanceof Error ? err.message : String(err);
      await recordOutlineFailure({
        analysisId,
        ideaIndex,
        error: `api error: ${message}`,
        model,
        costUsd: 0,
      });
      return { status: "failed", error: message };
    }

    const usage = readUsage(response);
    const costUsd = estimateCostUsd(model, usage);
    const raw = responseText(response);

    const parsed = parseOutlineResponse(raw);
    if (!parsed.ok) {
      // The raw response is the only thing that explains a parse failure, and it
      // was being thrown away while still being paid for.
      await recordOutlineFailure({
        analysisId,
        ideaIndex,
        error: parsed.error,
        rawResponse: raw,
        model,
        costUsd,
      });
      await recordSpend(costUsd);
      return { status: "failed", error: parsed.error };
    }

    const outline = await upsertOutline({
      analysisId,
      ideaIndex,
      payload: parsed.payload,
      rawResponse: raw,
      model,
      costUsd,
    });
    await recordSpend(costUsd);

    return { status: "ok", outline, payload: parsed.payload, costUsd };
  }
}

async function upsertOutline(input: {
  analysisId: number;
  ideaIndex: number;
  payload: OutlinePayload;
  rawResponse: string;
  model: AnalysisModel;
  costUsd: number;
}): Promise<Outline> {
  await upsertReturning(
    db,
    outlines,
    {
      analysisId: input.analysisId,
      ideaIndex: input.ideaIndex,
      status: "ok",
      error: null,
      content: input.payload,
      rawResponse: input.rawResponse,
      model: input.model,
      costUsd: toCostString(input.costUsd),
    },
    {
      target: [outlines.analysisId, outlines.ideaIndex],
      set: {
        status: "ok",
        error: null,
        content: input.payload,
        rawResponse: input.rawResponse,
        model: input.model,
        costUsd: toCostString(input.costUsd),
      },
    },
  );

  const [row] = await db
    .select()
    .from(outlines)
    .where(and(eq(outlines.analysisId, input.analysisId), eq(outlines.ideaIndex, input.ideaIndex)))
    .limit(1);
  if (!row) throw new Error("Upserted outline but could not read it back");
  return row;
}
