/**
 * Content gaps (build 4 §3.G): "competitors and the audience cover X, this
 * brand does not". Pure: the prompt over the gathered inputs and the check of
 * the model's answer. Every gap must point at inputs that exist — a gap whose
 * evidence the model made up is dropped, not stored.
 */

import type { ContentGapEvidence } from "@/db/schema";

export const GAP_INPUT_KINDS = [
  "competitor_post",
  "report",
  "question",
  "own_post",
  "idea",
  "script",
] as const;
export type GapInputKind = (typeof GAP_INPUT_KINDS)[number];

/** Ref prefixes, one per kind: `cp:12`, `report:3`, `q:7`, `post:4`, `idea:9`, `script:2`. */
export const REF_PREFIX: Record<GapInputKind, string> = {
  competitor_post: "cp",
  report: "report",
  question: "q",
  own_post: "post",
  idea: "idea",
  script: "script",
};

export type GapInput = { kind: GapInputKind; ref: string; text: string };

export type GapInputs = {
  brand: { id: string; name: string; niche: string; market: string; language: string };
  /** What others do and what the audience asks: competitor posts, report findings, questions. */
  market: GapInput[];
  /** What the brand already covers: its published posts, ideas and script titles. */
  own: GapInput[];
};

export const GAP_MIN = 5;
export const GAP_MAX = 10;
const TEXT_CHARS = 220;

export const GAPS_JSON_SCHEMA = {
  type: "object",
  properties: {
    gaps: {
      type: "array",
      minItems: 1,
      maxItems: GAP_MAX,
      items: {
        type: "object",
        properties: {
          topic: { type: "string", description: "The uncovered topic, in a few words." },
          angle: {
            type: "string",
            description: "How this brand should cover it: the hook or take, one sentence.",
          },
          evidence: {
            type: "array",
            minItems: 1,
            maxItems: 6,
            items: {
              type: "object",
              properties: {
                ref: { type: "string", description: "A ref from the inputs, exactly, e.g. cp:12." },
                note: { type: "string", description: "What that input shows, one short line." },
              },
              required: ["ref", "note"],
            },
          },
          score: {
            type: "integer",
            minimum: 1,
            maximum: 10,
            description: "Demand × how uncovered it is for this brand, 1–10.",
          },
        },
        required: ["topic", "angle", "evidence", "score"],
      },
    },
  },
  required: ["gaps"],
} as const;

export const GAPS_SYSTEM = `You find content gaps for a small business's social media: topics its competitors post about or its audience asks about that the business itself has not covered yet.

Use only the inputs you are given. Every gap cites at least one market input (competitor post, report finding or audience question) by its ref, exactly as written (e.g. "cp:12", "q:3"); cite an own input only to show it covers the topic weakly. Never cite a ref that is not in the inputs. A topic the brand already covers well is not a gap. Score 1–10: proven demand times how uncovered it is. Write topic and angle in the brand's language.

Answer with JSON matching the schema and nothing else.`;

const clip = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, TEXT_CHARS);

function lines(items: GapInput[]): string {
  return items.map((i) => `- ${i.ref} [${i.kind}] ${clip(i.text)}`).join("\n");
}

export function buildGapPrompt(inputs: GapInputs): string {
  const b = inputs.brand;
  return `Brand: ${b.name} (${b.niche}), market: ${b.market}, language: ${b.language}

MARKET — what competitors post and what the audience asks:
${lines(inputs.market) || "(none)"}

OWN — what ${b.name} already published, planned or scripted:
${lines(inputs.own) || "(nothing yet)"}

Find ${GAP_MIN}–${GAP_MAX} gaps, best first.`;
}

export type ValidGap = {
  topic: string;
  angle: string | null;
  evidence: ContentGapEvidence[];
  score: number;
};

export type GapValidation = { gaps: ValidGap[]; dropped: string[] };

/** `cp:12` → `competitor_post`; null for anything that is not a known ref shape. */
export function refKind(ref: string): GapInputKind | null {
  const prefix = ref.split(":")[0];
  const entry = Object.entries(REF_PREFIX).find(([, p]) => p === prefix);
  return entry ? (entry[0] as GapInputKind) : null;
}

/**
 * Check the model's answer against the inputs: evidence refs must exist (the
 * rest are dropped), a gap needs at least one market ref, scores are clamped
 * to whole 1–10, duplicate topics (case-insensitive) keep the first, and at
 * most `GAP_MAX` survive, best score first. Never throws on a bad item — it
 * lands in `dropped` with the reason.
 */
export function validateGaps(raw: unknown, inputs: GapInputs): GapValidation {
  const known = new Map<string, GapInput>();
  for (const i of [...inputs.market, ...inputs.own]) known.set(i.ref, i);
  const marketRefs = new Set(inputs.market.map((i) => i.ref));

  const list = (raw as { gaps?: unknown } | null)?.gaps;
  const dropped: string[] = [];
  if (!Array.isArray(list)) return { gaps: [], dropped: ["The answer has no gaps list."] };

  const seen = new Set<string>();
  const gaps: ValidGap[] = [];
  for (const [n, item] of list.entries()) {
    const g = item as Partial<{
      topic: unknown;
      angle: unknown;
      evidence: unknown;
      score: unknown;
    }>;
    const topic = typeof g?.topic === "string" ? g.topic.trim().slice(0, 300) : "";
    if (!topic) {
      dropped.push(`#${n + 1}: no topic`);
      continue;
    }
    const key = topic.toLowerCase();
    if (seen.has(key)) {
      dropped.push(`#${n + 1} "${topic}": duplicate topic`);
      continue;
    }
    const evidence: ContentGapEvidence[] = [];
    for (const e of Array.isArray(g.evidence) ? g.evidence : []) {
      const ref = typeof e?.ref === "string" ? e.ref.trim() : "";
      const input = known.get(ref);
      if (!input || evidence.some((x) => x.ref === ref)) continue;
      const note = typeof e?.note === "string" && e.note.trim() ? e.note.trim() : clip(input.text);
      evidence.push({ kind: input.kind, ref, note: note.slice(0, 300) });
    }
    if (!evidence.some((e) => marketRefs.has(e.ref))) {
      dropped.push(`#${n + 1} "${topic}": no evidence from the inputs`);
      continue;
    }
    const rawScore = typeof g.score === "number" && Number.isFinite(g.score) ? g.score : 5;
    const score = Math.min(10, Math.max(1, Math.round(rawScore)));
    const angle =
      typeof g.angle === "string" && g.angle.trim() ? g.angle.trim().slice(0, 600) : null;
    seen.add(key);
    gaps.push({ topic, angle, evidence, score });
  }
  gaps.sort((a, b) => b.score - a.score);
  if (gaps.length > GAP_MAX) {
    for (const g of gaps.slice(GAP_MAX)) dropped.push(`"${g.topic}": over ${GAP_MAX}`);
  }
  return { gaps: gaps.slice(0, GAP_MAX), dropped };
}

/** The idea a gap becomes: title, angle and a brief that carries the evidence. */
export function gapIdeaCopy(gap: {
  topic: string;
  angle: string | null;
  evidence: ContentGapEvidence[];
}): { title: string; angle: string; draftCopy: string } {
  const evidence = gap.evidence.map((e) => `- ${e.note} (${e.ref})`).join("\n");
  return {
    title: gap.topic,
    angle: gap.angle ?? gap.topic,
    draftCopy: `Content gap: ${gap.topic}.${gap.angle ? `\nAngle: ${gap.angle}` : ""}\n\nWhy (evidence):\n${evidence}`,
  };
}
