import type { CompetitorReport } from "./types";

/**
 * The weekly competitor report's contract (build 2b, idea 1): the JSON schema
 * the model answers against, the prompt, and the check its answer must pass
 * before a `competitor_reports` row is written. Pure — no database, no model —
 * so the unit tests cover it; `report.ts` is the part that does I/O.
 */

export const REPORT_MAX_WINNERS = 8;
export const REPORT_MAX_PATTERNS = 6;
export const REPORT_MAX_IDEAS = 6;

/** What the prompt is told about one outlier. Drawn from `topOutliersForBrand`. */
export type ReportInputVideo = {
  videoId: number;
  title: string;
  channel: string;
  outlierScore: number;
  viewCount: number;
  analysisSummary: string | null;
};

export const COMPETITOR_REPORT_JSON_SCHEMA = {
  type: "object",
  properties: {
    summary: {
      type: "string",
      description: "Two to four sentences: what happened among these channels in the period.",
    },
    winners: {
      type: "array",
      maxItems: REPORT_MAX_WINNERS,
      items: {
        type: "object",
        properties: {
          videoId: { type: "integer", description: "The id given in the list, unchanged." },
          whyItWorked: {
            type: "string",
            description:
              "One or two sentences: the hook, format or promise that made it beat its channel.",
          },
        },
        required: ["videoId", "whyItWorked"],
      },
    },
    patterns: {
      type: "array",
      maxItems: REPORT_MAX_PATTERNS,
      items: {
        type: "string",
        description: "A pattern shared by several winners: hook, format or title shape.",
      },
    },
    ideas: {
      type: "array",
      maxItems: REPORT_MAX_IDEAS,
      items: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "A working title for Anton's own video, under 70 characters.",
          },
          angle: {
            type: "string",
            description:
              "What Anton's video does that the competitors' did not: his own angle, one or two sentences.",
          },
          basedOnVideoIds: {
            type: "array",
            items: { type: "integer" },
            description: "Ids from the list that prove the demand.",
          },
        },
        required: ["title", "angle", "basedOnVideoIds"],
      },
    },
  },
  required: ["summary", "winners", "patterns", "ideas"],
} as const;

export const REPORT_SYSTEM_PROMPT = `You are a YouTube strategist writing a weekly brief for Anton, a creator who films himself explaining things on camera. You are given the competitor videos that beat their own channel's median views this period. Explain why they worked and propose videos Anton could make. Every idea must be Anton's own angle — a gap the competitors left, a sharper promise, a local detail, a different viewer — never a remake or a reworded title of a competitor's video. Do not invent view counts, dates, laws or prices. Answer with JSON matching the required schema and nothing else.`;

export function buildReportPrompt(
  brand: { name: string; niche: string; market: string },
  days: number,
  videos: ReportInputVideo[],
): string {
  const list = videos
    .map((v) => {
      const lines = [
        `- id ${v.videoId}: "${v.title}" — ${v.channel}, ${v.viewCount.toLocaleString("en-US")} views, ${v.outlierScore.toFixed(1)}× its channel's median`,
      ];
      if (v.analysisSummary) lines.push(`  What the video covers: ${v.analysisSummary}`);
      return lines.join("\n");
    })
    .join("\n");
  return `Brand: ${brand.name} (${brand.niche}), market: ${brand.market}
Period: the last ${days} days.

Competitor and inspiration videos that beat their own channel's median:
${list}

Write the summary, pick the winners worth learning from (by id), name the patterns, and propose up to ${REPORT_MAX_IDEAS} video ideas for Anton. Base each idea on one or more ids, but make it his own angle, never a copy.`;
}

export class InvalidReportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidReportError";
  }
}

/** Lowercase, no accents, no punctuation — for "is this idea just their title?". */
function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/**
 * Turn the model's answer into a `CompetitorReport`, or throw.
 *
 * The model is trusted for words, not for facts: a winner's title, channel and
 * score are copied from our own rows by id, ids it made up are dropped, and an
 * idea whose title is a competitor's title (ignoring case, accents and
 * punctuation) is dropped too — the report is for Anton's angles, not copies.
 * A report with no summary, or nothing left in either list, is refused.
 */
export function validateCompetitorReport(
  raw: unknown,
  videos: ReportInputVideo[],
): CompetitorReport {
  if (typeof raw !== "object" || raw === null)
    throw new InvalidReportError("The report is not a JSON object.");
  const r = raw as Record<string, unknown>;
  const byId = new Map(videos.map((v) => [v.videoId, v]));
  const theirTitles = new Set(videos.map((v) => fold(v.title)));

  const summary = str(r.summary);
  if (!summary) throw new InvalidReportError("The report has no summary.");

  const winners: CompetitorReport["winners"] = [];
  for (const w of Array.isArray(r.winners) ? r.winners : []) {
    const id = Number((w as Record<string, unknown>)?.videoId);
    const video = byId.get(id);
    const why = str((w as Record<string, unknown>)?.whyItWorked);
    if (!video || !why || winners.some((x) => x.videoId === id)) continue;
    winners.push({
      videoId: id,
      title: video.title,
      channel: video.channel,
      outlierScore: Math.round(video.outlierScore * 100) / 100,
      whyItWorked: why,
    });
    if (winners.length === REPORT_MAX_WINNERS) break;
  }

  const patterns = (Array.isArray(r.patterns) ? r.patterns : [])
    .map(str)
    .filter(Boolean)
    .slice(0, REPORT_MAX_PATTERNS);

  const ideas: CompetitorReport["ideas"] = [];
  for (const i of Array.isArray(r.ideas) ? r.ideas : []) {
    const idea = (i ?? {}) as Record<string, unknown>;
    const title = str(idea.title);
    const angle = str(idea.angle);
    if (!title || !angle || theirTitles.has(fold(title))) continue;
    const basedOn = (Array.isArray(idea.basedOnVideoIds) ? idea.basedOnVideoIds : [])
      .map(Number)
      .filter((id, n, all) => byId.has(id) && all.indexOf(id) === n);
    ideas.push({ title, angle, basedOnVideoIds: basedOn });
    if (ideas.length === REPORT_MAX_IDEAS) break;
  }

  if (winners.length === 0 && ideas.length === 0) {
    throw new InvalidReportError("The report names no known video and no usable idea.");
  }
  return { summary, winners, patterns, ideas };
}

/** `/studio/new?brand=…&topic=…&ref=…` for one idea's "Write script". */
export function writeScriptHref(brandId: string, topic: string, refs: number[] = []): string {
  const q = new URLSearchParams({ brand: brandId, topic });
  for (const r of refs) q.append("ref", String(r));
  return `/studio/new?${q}`;
}
