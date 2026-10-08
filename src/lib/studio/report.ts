import "server-only";
import { structuredJson } from "@/lib/ai";
import { costUsdAtRates, ideationRates } from "@/lib/analysis/pricing";
import { getBrand } from "@/lib/bridge/brands";
import { saveCompetitorReport, type SavedReport } from "@/lib/bridge/reports";
import { topOutliersForBrand } from "@/lib/bridge/research";
import {
  buildReportPrompt,
  COMPETITOR_REPORT_JSON_SCHEMA,
  REPORT_SYSTEM_PROMPT,
  validateCompetitorReport,
  type ReportInputVideo,
} from "./report-contract";

/**
 * The weekly competitor report (build 2b, idea 1): what beat its own
 * channel's median among a brand's competitor and inspiration channels in the
 * window, why, and ideas for Anton's own videos. One `structuredJson` call
 * (§1.38: Gemini under the spend cap, or the logged-in CLI at $0), no web
 * search, validated before anything is saved.
 */

/** Outliers handed to the model; more is noise, and each one costs tokens. */
export const REPORT_MAX_VIDEOS = 20;

const REPORT_MAX_OUTPUT_TOKENS = 4_000;
const REPORT_THINKING_TOKENS = 2_000;
/** System prompt + brand + 20 titles with a digest summary each, rounded up. */
const REPORT_PROMPT_TOKENS = 8_000;

/** The same model `structuredJson` bills on (`ai.ts` reads the same variable). */
const studioModel = () => process.env.GEMINI_MODEL ?? "gemini-3.7-flash";

export function estimateReportCostUsd(model: string = studioModel()): number {
  return costUsdAtRates(ideationRates(model), {
    inputTokens: REPORT_PROMPT_TOKENS,
    outputTokens: REPORT_MAX_OUTPUT_TOKENS + REPORT_THINKING_TOKENS,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  });
}

export type BuildReportResult =
  | { ok: true; report: SavedReport }
  | { ok: false; reason: "no_brand" | "no_outliers"; message: string };

/**
 * Build and save a report for one brand over the last `days` days. Nothing
 * beat its channel's median in the window → nothing is saved (and nothing is
 * spent), and the result says so. A model or spend-cap failure throws.
 */
export async function buildCompetitorReport(brandId: string, days = 7): Promise<BuildReportResult> {
  const brand = await getBrand(brandId);
  if (!brand) return { ok: false, reason: "no_brand", message: `No brand "${brandId}".` };
  const window = Math.max(1, Math.floor(days));

  const ranked = await topOutliersForBrand(brandId, { days: window, limit: REPORT_MAX_VIDEOS });
  const videos: ReportInputVideo[] = ranked
    .filter((v) => v.score > 1)
    .map((v) => ({
      videoId: v.videoId,
      title: v.title,
      channel: v.channelTitle ?? v.sourceTitle,
      outlierScore: v.score,
      viewCount: v.viewCount,
      analysisSummary: v.analysisSummary,
    }));
  if (videos.length === 0) {
    return {
      ok: false,
      reason: "no_outliers",
      message: `No new outliers for ${brand.name} in the last ${window} days — no report saved.`,
    };
  }

  const { text, costUsd, finishReason } = await structuredJson({
    system: REPORT_SYSTEM_PROMPT,
    prompt: buildReportPrompt(brand, window, videos),
    schema: COMPETITOR_REPORT_JSON_SCHEMA,
    webSearch: false,
    estimateUsd: estimateReportCostUsd(),
    maxOutputTokens: REPORT_MAX_OUTPUT_TOKENS,
    thinkingLow: true,
  });

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(
      `The model didn't return a parseable report (finish reason: ${finishReason ?? "unknown"}). Try again.`,
    );
  }
  const body = validateCompetitorReport(raw, videos);
  const report = await saveCompetitorReport({ brandId, periodDays: window, body, costUsd });
  return { ok: true, report };
}
