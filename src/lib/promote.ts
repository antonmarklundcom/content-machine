import { insertReturning } from "@/db/mutations";
import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clips, ideas, FORMATS, type Format, type Idea } from "@/db/schema";
import { adaptIdeaToBrand } from "@/lib/ai";
import { analysisBundleForVideo, getAnalysis, getAnalysisWithVideo, getBrand } from "@/lib/bridge";
import { isUnitType, type UnitType } from "@/lib/listen/units";

/**
 * Promote: one piece of the YouTube corpus becomes one idea for one brand
 * (PLAN.md §5.O2.3). This is the bridge's whole point in one function — the
 * only place a `videos`-side row turns into a `brands`-side row.
 *
 * Two sources, because there are two things worth promoting: a unit the reader
 * starred while listening (`video_unit_marks`), and an idea the analysis itself
 * proposed (`analyses.ideas[n]`). Both resolve to the same thing — some text,
 * and the analysis id that produced it.
 */

export type PromoteSource =
  /** A unit of a video's latest analysis — what a star in the reading view points at. */
  | { kind: "unit"; videoId: number; unitType: UnitType; unitIndex: number }
  /** One entry of `analyses.ideas`. */
  | { kind: "analysis-idea"; analysisId: number; ideaIndex: number };

export type PromoteInput = {
  source: PromoteSource;
  brandId: string;
  format: Format;
  platform: string;
  /**
   * Spend one cheap model call to rewrite the material in the brand's voice.
   * Off by default: promoting verbatim is free, and free must be the default
   * for a button that gets pressed dozens of times in an evening.
   */
  adapt?: boolean;
  /** The inbox clip this came from, marked `promoted` and linked on success. */
  clipId?: number;
};

export type PromoteResult =
  { ok: true; idea: Idea; costUsd: number } | { ok: false; status: 400 | 404; error: string };

export function isFormat(value: unknown): value is Format {
  return typeof value === "string" && (FORMATS as readonly string[]).includes(value);
}

export { isUnitType };

/** Resolved source material: what to write about, and what produced it. */
type Material = {
  analysisId: number;
  videoTitle: string;
  /** A short internal name — the fallback `ideas.title` when not adapting. */
  title: string;
  /** The text itself, verbatim from the analysis. */
  text: string;
};

/** `ideas.title` is text, but a title that runs past a line is not a title. */
const TITLE_LIMIT = 120;

function toTitle(text: string): string {
  const firstSentence = text.split(/(?<=[.!?])\s/)[0] ?? text;
  const candidate = firstSentence.trim() || text.trim();
  return candidate.length <= TITLE_LIMIT ? candidate : `${candidate.slice(0, TITLE_LIMIT - 1)}…`;
}

async function resolveMaterial(source: PromoteSource): Promise<Material | { error: string }> {
  if (source.kind === "unit") {
    // Read through the bridge, not the tables: `analysisBundleForVideo` already
    // decides which of an append-only video's analyses is "the" one, and a
    // second opinion here would eventually disagree with the reading view.
    const bundle = await analysisBundleForVideo(source.videoId);
    if (!bundle) return { error: `No video ${source.videoId}.` };
    if (!bundle.analysis) return { error: "That video has no analysis to promote from." };

    const unit = bundle.units.find(
      (u) => u.type === source.unitType && u.index === source.unitIndex,
    );
    if (!unit) {
      // Analyses are append-only and re-analysis can drop a unit a mark points
      // at — a real state, and one the caller can act on by re-reading.
      return { error: "That unit is not in this video's current analysis." };
    }

    return {
      analysisId: bundle.analysis.id,
      videoTitle: bundle.video.title,
      title: toTitle(unit.text),
      text: unit.text,
    };
  }

  const found = await getAnalysisWithVideo(source.analysisId);
  if (!found) return { error: `No analysis ${source.analysisId}.` };
  const idea = found.analysis.ideas?.[source.ideaIndex];
  if (!idea)
    return { error: `Analysis ${source.analysisId} has no idea at index ${source.ideaIndex}.` };

  const text = [idea.title, idea.premise, idea.why_now].filter(Boolean).join("\n");
  return {
    analysisId: found.analysis.id,
    videoTitle: found.video?.title ?? "an analysed video",
    title: toTitle(idea.title || text),
    text,
  };
}

/**
 * Insert the idea. `status` is `proposed` — promoting is a suggestion, and the
 * approve/reject decision stays where it already lives.
 */
export async function promoteToIdea(input: PromoteInput): Promise<PromoteResult> {
  const brand = await getBrand(input.brandId);
  if (!brand) return { ok: false, status: 404, error: `unknown brandId "${input.brandId}"` };

  const material = await resolveMaterial(input.source);
  if ("error" in material) return { ok: false, status: 404, error: material.error };

  let title = material.title;
  let angle = `Promoted from "${material.videoTitle}".`;
  let draftCopy = material.text;
  let visualNotes: string | null = null;
  let costUsd = 0;

  if (input.adapt) {
    const adapted = await adaptIdeaToBrand(brand, {
      sourceText: material.text,
      videoTitle: material.videoTitle,
      format: input.format,
      platform: input.platform,
    });
    title = adapted.idea.title || title;
    angle = adapted.idea.angle || angle;
    draftCopy = adapted.idea.draftCopy || draftCopy;
    visualNotes = adapted.idea.visualNotes ?? null;
    costUsd = adapted.costUsd;
  }

  const [idea] = await insertReturning(db, ideas, {
    brandId: brand.id,
    title,
    angle,
    format: input.format,
    platform: input.platform,
    draftCopy,
    visualNotes,
    sourceAnalysisId: material.analysisId,
    status: "proposed" as const,
  });

  if (input.clipId !== undefined) {
    // Best-effort: the idea exists either way, and a clip that fails to update
    // is a wrong badge in the inbox, not a lost promotion.
    await db
      .update(clips)
      .set({ status: "promoted", ideaId: idea.id, error: null })
      .where(eq(clips.id, input.clipId));
  }

  return { ok: true, idea, costUsd };
}

/** The analysis behind a promoted idea, for anything showing provenance. */
export async function analysisForIdea(idea: Idea) {
  return idea.sourceAnalysisId === null ? null : getAnalysis(idea.sourceAnalysisId);
}
