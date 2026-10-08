/**
 * Comment mining's pure half (build 2b, idea 2): which comments are likely
 * questions, the schema the model clusters them into, and the check its answer
 * must pass. No database, no network — `questions.ts` does the I/O.
 */

export const MAX_QUESTION_CLUSTERS = 20;
export const MAX_QUESTION_EXAMPLES = 5;
/** Comments handed to the model in one run, and how much of each. */
export const MAX_COMMENTS_TO_CLUSTER = 400;
export const MAX_COMMENT_CHARS = 400;

/**
 * Words that open a question in English or Spanish, accent-folded. The leading
 * position is what makes them a question. Spanish "que", "como", "es", "hay"
 * and "se" are left out: they open statements just as often ("Que buen
 * video"), so without a `?` they only count inside a phrase below.
 */
const OPENERS = new Set([
  // en
  "how",
  "what",
  "whats",
  "why",
  "when",
  "where",
  "which",
  "who",
  "whom",
  "whose",
  "can",
  "could",
  "does",
  "do",
  "did",
  "is",
  "are",
  "should",
  "would",
  "anyone",
  "anybody",
  // es
  "cual",
  "cuales",
  "cuando",
  "donde",
  "adonde",
  "quien",
  "quienes",
  "cuanto",
  "cuanta",
  "cuantos",
  "cuantas",
  "puedo",
  "puede",
  "pueden",
  "alguien",
  "sabes",
  "saben",
  "conviene",
]);

/** Phrases that mark a question anywhere in a comment, question mark or not. */
const PHRASES = [
  "does anyone",
  "anyone know",
  "any idea",
  "i wonder",
  "i was wondering",
  "can someone",
  "can you explain",
  "how do i",
  "how do you",
  "how much",
  "is it possible",
  "what about",
  "alguien sabe",
  "me pregunto",
  "por que",
  "como hago",
  "como se",
  "cuanto cuesta",
  "cuanto sale",
  "se puede",
  "hay alguna",
  "que pasa si",
  "me podes",
  "me pueden",
  "podrias explicar",
];

export function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/**
 * Whether a comment is likely a question: a `?` / `¿`, a question phrase, or
 * a sentence that opens with a question word. Deliberately generous — the
 * model clusters and discards afterwards; this only keeps "great video!" and
 * the like from being paid for.
 */
export function isLikelyQuestion(comment: string): boolean {
  const text = comment.trim();
  if (text.length < 8 || text.length > 2_000) return false;
  if (text.includes("?") || text.includes("¿")) return true;
  const folded = fold(text);
  if (PHRASES.some((p) => folded.includes(p))) return true;
  // Each sentence's first word; a question buried after "Great video." counts.
  for (const sentence of folded.split(/[.!\n]+/)) {
    const first = sentence
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .trim()
      .split(/\s+/)[0];
    if (first && OPENERS.has(first)) return true;
  }
  return false;
}

/** The key a question is upserted by: folded, no punctuation, single spaces. */
export function normalizeQuestion(question: string): string {
  return fold(question)
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export type CommentForClustering = { videoId: number; text: string };

export const QUESTIONS_JSON_SCHEMA = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      maxItems: MAX_QUESTION_CLUSTERS,
      items: {
        type: "object",
        properties: {
          question: {
            type: "string",
            description:
              "The question in one clean sentence, in the language most commenters used.",
          },
          askCount: {
            type: "integer",
            minimum: 1,
            description: "How many of the comments ask it.",
          },
          examples: {
            type: "array",
            maxItems: MAX_QUESTION_EXAMPLES,
            items: { type: "string" },
            description: "Up to five comments, copied verbatim.",
          },
          videoIds: {
            type: "array",
            items: { type: "integer" },
            description: "The video ids the asking comments were under.",
          },
        },
        required: ["question", "askCount", "examples", "videoIds"],
      },
    },
  },
  required: ["questions"],
} as const;

export const QUESTIONS_SYSTEM_PROMPT = `You group YouTube comments into the questions viewers actually ask, so a creator can answer them in his own videos. Merge comments that ask the same thing in different words. Skip anything that is not a real question about the topic (jokes, praise, questions to other commenters about unrelated things, spam). Keep the language the viewers used. Copy examples verbatim from the given comments; never write your own. Answer with JSON matching the required schema and nothing else.`;

export function buildQuestionsPrompt(
  brand: { name: string; niche: string },
  comments: CommentForClustering[],
): string {
  const lines = comments
    .map((c) => `[video ${c.videoId}] ${c.text.replace(/\s+/g, " ").slice(0, MAX_COMMENT_CHARS)}`)
    .join("\n");
  return `Niche: ${brand.niche} (brand ${brand.name}).

Comments under competitor videos that look like questions, one per line, each tagged with its video id:
${lines}

Cluster them into at most ${MAX_QUESTION_CLUSTERS} distinct questions, most asked first.`;
}

export type QuestionCluster = {
  question: string;
  askCount: number;
  examples: string[];
  videoIds: number[];
};

/**
 * The model's clusters, cleaned: blank questions dropped, duplicates (by
 * normalised text) merged, counts made positive integers, examples trimmed to
 * five non-empty strings, and video ids kept only if they were in the input.
 */
export function validateQuestionClusters(
  raw: unknown,
  knownVideoIds: Iterable<number>,
): QuestionCluster[] {
  const known = new Set(knownVideoIds);
  const list = (raw as { questions?: unknown } | null)?.questions;
  if (!Array.isArray(list)) throw new Error("The model's answer has no questions list.");

  const byKey = new Map<string, QuestionCluster>();
  for (const item of list) {
    const q = (item ?? {}) as Record<string, unknown>;
    const question = typeof q.question === "string" ? q.question.trim().replace(/\s+/g, " ") : "";
    const key = normalizeQuestion(question);
    if (!key) continue;
    const count = Math.max(1, Math.floor(Number(q.askCount) || 1));
    const examples = (Array.isArray(q.examples) ? q.examples : [])
      .filter((e): e is string => typeof e === "string" && e.trim() !== "")
      .map((e) => e.trim());
    const videoIds = (Array.isArray(q.videoIds) ? q.videoIds : [])
      .map(Number)
      .filter((id) => known.has(id));

    const existing = byKey.get(key);
    if (existing) {
      existing.askCount += count;
      existing.examples = mergeExamples(existing.examples, examples);
      existing.videoIds = mergeIds(existing.videoIds, videoIds);
    } else {
      byKey.set(key, {
        question,
        askCount: count,
        examples: mergeExamples([], examples),
        videoIds: mergeIds([], videoIds),
      });
    }
  }
  return [...byKey.values()]
    .sort((a, b) => b.askCount - a.askCount)
    .slice(0, MAX_QUESTION_CLUSTERS);
}

export function mergeExamples(a: string[], b: string[]): string[] {
  const out = [...a];
  for (const e of b) if (!out.includes(e) && out.length < MAX_QUESTION_EXAMPLES) out.push(e);
  return out.slice(0, MAX_QUESTION_EXAMPLES);
}

export function mergeIds(a: number[], b: number[]): number[] {
  return [...new Set([...a, ...b])];
}
