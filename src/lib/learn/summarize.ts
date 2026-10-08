import { structuredJson } from "@/lib/ai";
import { costUsdAtRates, ideationRates } from "@/lib/analysis/pricing";
import { LEARN_CATEGORIES, toLearnCategory, type LearnCategory } from "./categories";

/**
 * The learn summary (docs/PLAN-build4.md §1.13), ported from aiinsights'
 * `summarize.ts`: one structured-JSON call through `structuredJson`, so it
 * runs on Gemini under the spend cap or on the logged-in CLI for free.
 *
 * The prompt and the parse are pure and tested; the call goes through a
 * `LearnModelRunner` seam because the Gemini fake answers only the schemas it
 * knows, and this one is new (see docs/log/b4-e.md, "Link pass").
 */

/** Long transcripts are cut here; the prompt says so, so the model does not invent the rest. */
export const LEARN_TRANSCRIPT_MAX_CHARS = 30_000;
/** A README excerpt for grounding, not the whole file. */
export const LEARN_README_MAX_CHARS = 6_000;
const PAGE_TEXT_MAX_CHARS = 4_000;

export const LEARN_SUMMARY_JSON_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "Short descriptive title, max ~8 words." },
    whatItIs: {
      type: "string",
      description: "2-3 plain sentences: what this tool, repo or trick is.",
    },
    whyItMatters: {
      type: "string",
      description: "1-2 sentences: why a developer would want it, what it saves or unlocks.",
    },
    howToStart: {
      type: "array",
      items: { type: "string" },
      minItems: 1,
      maxItems: 8,
      description:
        "3-6 concrete, ordered getting-started steps. If there is not enough information for real steps, one step saying what is missing.",
    },
    category: {
      type: "string",
      enum: [...LEARN_CATEGORIES],
      description: "The single best-fitting category. 'other' only when none of the rest fit.",
    },
    tags: {
      type: "array",
      items: { type: "string" },
      maxItems: 8,
      description: "3-6 short lowercase tags (tech names, use case).",
    },
  },
  required: ["title", "whatItIs", "whyItMatters", "howToStart", "category", "tags"],
} as const;

export const LEARN_SYSTEM_PROMPT = [
  "You help someone build a personal knowledge base of AI tools, open-source repos and dev tricks they saved from Instagram, YouTube, GitHub and articles, and want to actually use later.",
  "",
  "Given what is known about one saved item, answer with: a clear title, what it is, why it matters, concrete ordered steps to get started (assume a developer comfortable with the terminal, npm and git), one category, and tags.",
  "",
  "Rules:",
  "- Always write in English, whatever language the caption, transcript or note is in.",
  `- A transcript may be cut at ${LEARN_TRANSCRIPT_MAX_CHARS.toLocaleString("en-US")} characters. If it ends mid-thought, summarise what is there and do not invent the rest.`,
  "- If a repo README is provided, ground the summary and the steps in it rather than guessing from the title.",
  "- If a screenshot description is provided, use the text read from it (repo names, commands, captions).",
  "- If there is barely any information, say so honestly in whatItIs and make howToStart a single step asking for a quick note about what the content covered.",
  "Answer with JSON matching the required schema and nothing else.",
].join("\n");

export type LearnSummaryInput = {
  url: string;
  platform: string;
  title?: string | null;
  note?: string | null;
  /** Page description, or the post's caption. */
  caption?: string | null;
  transcript?: string | null;
  repoUrl?: string | null;
  repoReadme?: string | null;
  /** What Gemini vision read off a forwarded screenshot. */
  screenshot?: string | null;
};

export type LearnSummary = {
  title: string;
  whatItIs: string;
  whyItMatters: string;
  howToStart: string[];
  category: LearnCategory;
  tags: string[];
};

export class LearnSummaryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LearnSummaryError";
  }
}

function clip(text: string, max: number): { text: string; cut: boolean } {
  return text.length > max ? { text: text.slice(0, max), cut: true } : { text, cut: false };
}

/** Whether there is anything to summarise beyond the bare URL (aiinsights' `needs_note`). */
export function hasLearnContent(input: LearnSummaryInput): boolean {
  return [input.note, input.caption, input.transcript, input.repoReadme, input.screenshot].some(
    (s) => Boolean(s?.trim()),
  );
}

/** The user turn: everything known about the item, labelled. */
export function buildLearnPrompt(input: LearnSummaryInput): string {
  const parts = [`Source URL: ${input.url}`, `Platform: ${input.platform}`];
  if (input.title?.trim()) parts.push(`Page or post title: ${input.title.trim()}`);
  if (input.note?.trim()) parts.push(`The user's own note about it: ${input.note.trim()}`);
  if (input.caption?.trim()) {
    parts.push(
      `Post caption / page description:\n${clip(input.caption.trim(), PAGE_TEXT_MAX_CHARS).text}`,
    );
  }
  if (input.transcript?.trim()) {
    const t = clip(input.transcript.trim(), LEARN_TRANSCRIPT_MAX_CHARS);
    parts.push(
      `Video transcript (may be partial or noisy)${t.cut ? " (truncated)" : ""}:\n${t.text}`,
    );
  }
  if (input.screenshot?.trim()) parts.push(`Screenshot, as read:\n${input.screenshot.trim()}`);
  if (input.repoUrl) parts.push(`Linked repo: ${input.repoUrl}`);
  if (input.repoReadme?.trim()) {
    parts.push(
      `Repo README excerpt:\n${clip(input.repoReadme.trim(), LEARN_README_MAX_CHARS).text}`,
    );
  }
  return parts.join("\n\n");
}

const str = (v: unknown): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");

/**
 * Validate the model's answer. Throws `LearnSummaryError` when the parts that
 * make an item usable (what it is, at least one step) are missing; a category
 * outside the list becomes the nearest one (or `other`), tags are lower-cased
 * and deduped.
 */
export function parseLearnSummary(text: string): LearnSummary {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new LearnSummaryError("The model did not answer with JSON.");
  }
  if (!raw || typeof raw !== "object") throw new LearnSummaryError("The model answered nothing.");
  const whatItIs = str(raw.whatItIs);
  const howToStart = (Array.isArray(raw.howToStart) ? raw.howToStart : [])
    .map(str)
    .filter(Boolean)
    .slice(0, 8);
  if (!whatItIs) throw new LearnSummaryError("The summary has no 'what it is'.");
  if (howToStart.length === 0) throw new LearnSummaryError("The summary has no steps.");
  const tags: string[] = [];
  for (const t of Array.isArray(raw.tags) ? raw.tags : []) {
    const tag = str(t).replace(/^#+/, "").toLowerCase().slice(0, 64);
    if (tag && !tags.includes(tag)) tags.push(tag);
  }
  return {
    title: str(raw.title).slice(0, 512) || "Saved item",
    whatItIs,
    whyItMatters: str(raw.whyItMatters),
    howToStart,
    category: toLearnCategory(raw.category) ?? "other",
    tags: tags.slice(0, 8),
  };
}

/** What goes in `clips.summary`: what it is, then why it matters. */
export function learnSummaryText(s: Pick<LearnSummary, "whatItIs" | "whyItMatters">): string {
  return s.whyItMatters ? `${s.whatItIs}\n\nWhy it matters: ${s.whyItMatters}` : s.whatItIs;
}

const LEARN_MAX_OUTPUT_TOKENS = 2_000;
const LEARN_THINKING_TOKENS = 2_000;
/** Prompt + a full transcript and README at their caps, rounded up. */
const LEARN_PROMPT_TOKENS = 12_000;

/** The reservation held against the monthly cap (rounded up, the safe direction). */
export function estimateLearnSummaryCostUsd(
  model: string = process.env.GEMINI_MODEL ?? "gemini-3.7-flash",
): number {
  return costUsdAtRates(ideationRates(model), {
    inputTokens: LEARN_PROMPT_TOKENS,
    outputTokens: LEARN_MAX_OUTPUT_TOKENS + LEARN_THINKING_TOKENS,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  });
}

/** The structured-JSON call, as a seam: `structuredJson` in production, a canned answer in tests. */
export type LearnModelRunner = (opts: {
  system: string;
  prompt: string;
  schema: unknown;
  estimateUsd: number;
  maxOutputTokens: number;
}) => Promise<{ text: string; costUsd: number }>;

export const defaultLearnRunner: LearnModelRunner = (opts) =>
  structuredJson({ ...opts, webSearch: false, thinkingLow: true });

export async function summarizeLearn(
  input: LearnSummaryInput,
  run: LearnModelRunner = defaultLearnRunner,
): Promise<LearnSummary & { costUsd: number }> {
  const { text, costUsd } = await run({
    system: LEARN_SYSTEM_PROMPT,
    prompt: buildLearnPrompt(input),
    schema: LEARN_SUMMARY_JSON_SCHEMA,
    estimateUsd: estimateLearnSummaryCostUsd(),
    maxOutputTokens: LEARN_MAX_OUTPUT_TOKENS + LEARN_THINKING_TOKENS,
  });
  return { ...parseLearnSummary(text), costUsd };
}
