/**
 * The comment-reply prompt (build 4 §3.G, PLAN-build4 §1.11 — a reply is only
 * ever a draft). Pure: the server half (`draft.ts`) gathers the inputs and
 * makes the call. A question about prices or legal matters is flagged for a
 * person instead of answered from the model's guess.
 */

export const REPLY_JSON_SCHEMA = {
  type: "object",
  properties: {
    reply: {
      type: "string",
      description:
        "The reply as it would be posted under the comment, in the account's language. Short: one to three sentences.",
    },
    needsHuman: {
      type: "boolean",
      description:
        "True when a correct answer needs a person: a price or fee, a legal or tax question, the commenter's own case, a complaint, or anything the facts do not cover.",
    },
    humanReason: {
      type: "string",
      description: "When needsHuman is true: what the person has to check, in English. Else empty.",
    },
  },
  required: ["reply", "needsHuman", "humanReason"],
} as const;

export type ReplyFact = {
  topic: string;
  claim: string;
  verified: boolean;
  sourceUrl: string | null;
};

export type ReplyInput = {
  brand: { name: string; niche: string; voice: string | null };
  platform: string;
  handle: string;
  /** The account's effective language tag, e.g. `es-PY`. */
  language: string;
  languageName: string;
  /** `content/style/<language>.md`, whole (may be empty). */
  styleGuide: string;
  kit: { ctas: string[]; dos: string | null; donts: string | null } | null;
  /** The post's caption the comment sits under (may be empty). */
  caption: string;
  comment: { author: string | null; text: string };
  facts: ReplyFact[];
  /** The post's lead link, when it has one — the only URL the reply may give. */
  leadUrl: string | null;
};

export type ReplyDraft = { reply: string; needsHuman: boolean; humanReason: string };

export const MAX_REPLY_FACTS = 30;
const MAX_CAPTION_CHARS = 1_500;

/** Topics a model must not answer on its own, found by keyword in the comment. */
const HUMAN_TOPICS: { topic: string; pattern: RegExp }[] = [
  {
    topic: "price",
    pattern:
      /(precio|cu[aá]nto (cuesta|sale|cobr|vale)|costo|tarifa|presupuesto|honorario|\bprice|\bcost|how much|\bfee|\bquote\b|pre[cç]o|quanto custa|\bpris\b|kostar|kosten|\$|usd|\bgs\.?\s?\d|guaran[ií]es)/i,
  },
  {
    topic: "legal",
    pattern:
      /(abogad|\blegal|\bley\b|contrato|juicio|demanda|denuncia|impuesto|lawyer|\blaw\b|lawsuit|contract|\btax|advogad|jur[ií]dic|advokat|juridisk|\bskatt)/i,
  },
];

function words(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 4),
  );
}

/**
 * The facts most relevant to a comment under a caption: by words shared with
 * the fact's topic and claim (accents ignored), verified first on a tie, at
 * most `MAX_REPLY_FACTS`. Facts sharing nothing still come after, in order, so
 * a short comment ("¿y los requisitos?") is not left with none.
 */
export function rankFacts(facts: ReplyFact[], comment: string, caption: string): ReplyFact[] {
  const commentWords = words(comment);
  const captionWords = words(caption);
  return facts
    .map((f, i) => {
      const fw = words(`${f.topic} ${f.claim}`);
      let score = 0;
      for (const w of fw) score += commentWords.has(w) ? 3 : captionWords.has(w) ? 1 : 0;
      return { f, i, score };
    })
    .sort((a, b) => b.score - a.score || Number(b.f.verified) - Number(a.f.verified) || a.i - b.i)
    .slice(0, MAX_REPLY_FACTS)
    .map((x) => x.f);
}

/** Which human-only topics a comment touches (`price`, `legal`), by keyword. */
export function humanTopics(text: string): string[] {
  return HUMAN_TOPICS.filter((h) => h.pattern.test(text)).map((h) => h.topic);
}

export const REPLY_SYSTEM = `You draft replies to comments on a small business's social media posts. A person reviews every draft before anything is posted; nothing you write is sent automatically.

Write like the account's owner: warm, brief, specific to what the commenter said. Follow the style guide for the language exactly (for Paraguayan Spanish that means voseo: "vos tenés", "fijate", never "tú"). One to three sentences; at most one emoji; no hashtags.

Facts: state as fact only what the VERIFIED facts say, word for word in meaning. An UNVERIFIED fact may only be said hedged ("en general", "suele"). Never invent a price, fee, deadline, law, requirement or statistic. When the comment asks for a price or fee, a legal or tax answer, advice on the commenter's own case, or anything the facts do not cover, set needsHuman to true, say why in humanReason, and write a short friendly holding reply that invites them to a direct message (or to the lead link if one is given) without answering the question itself.

Answer with JSON matching the schema and nothing else.`;

function factLines(facts: ReplyFact[]): string {
  return facts
    .slice(0, MAX_REPLY_FACTS)
    .map(
      (f) =>
        `- [${f.topic}] ${f.verified ? "VERIFIED" : "UNVERIFIED — hedge it"}: ${f.claim}${
          f.sourceUrl ? ` (source: ${f.sourceUrl})` : ""
        }`,
    )
    .join("\n");
}

/** The user prompt for one comment. */
export function buildReplyPrompt(input: ReplyInput): string {
  const kit = input.kit;
  const kitLines = kit
    ? [
        kit.ctas.length ? `CTAs the brand uses: ${kit.ctas.join(" | ")}` : "",
        kit.dos?.trim() ? `Do: ${kit.dos.trim()}` : "",
        kit.donts?.trim() ? `Don't: ${kit.donts.trim()}` : "",
      ].filter(Boolean)
    : [];
  const topics = humanTopics(input.comment.text);
  const parts = [
    `Brand: ${input.brand.name} (${input.brand.niche})`,
    `Voice: ${input.brand.voice ?? "plain, warm, no hype"}`,
    `Account: @${input.handle} on ${input.platform}`,
    `Language: ${input.languageName} (tag ${input.language}). The reply is in this language only.`,
    input.styleGuide.trim() ? `\nSTYLE GUIDE — follow it:\n${input.styleGuide.trim()}` : "",
    kitLines.length ? `\nBRAND KIT:\n${kitLines.join("\n")}` : "",
    input.facts.length
      ? `\nFACTS — the brand's checked fact sheet:\n${factLines(input.facts)}`
      : "\nFACTS: none on file — answer nothing factual; flag factual questions for a person.",
    input.leadUrl ? `\nLEAD LINK (the only URL you may give): ${input.leadUrl}` : "",
    `\nPOST CAPTION:\n${input.caption.trim().slice(0, MAX_CAPTION_CHARS) || "(no caption)"}`,
    `\nCOMMENT by ${input.comment.author ? `@${input.comment.author}` : "a follower"}:\n${input.comment.text.trim()}`,
    topics.length
      ? `\nNOTE: this comment touches ${topics.join(" and ")} — a person must answer that part. Set needsHuman to true.`
      : "",
    "\nDraft the reply.",
  ];
  return parts.filter(Boolean).join("\n");
}

export class ReplyParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReplyParseError";
  }
}

/**
 * The model's answer, checked. The keyword check is applied on top of the
 * model's own flag: a price or legal comment is always flagged, whatever the
 * model said.
 */
export function parseReply(text: string, commentText: string): ReplyDraft {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ReplyParseError("The model did not return a parseable reply. Try again.");
  }
  const r = raw as Partial<ReplyDraft> | null;
  const reply = typeof r?.reply === "string" ? r.reply.trim() : "";
  if (!reply) throw new ReplyParseError("The model returned an empty reply. Try again.");
  const topics = humanTopics(commentText);
  const modelFlag = r?.needsHuman === true;
  const reasons = [
    modelFlag && typeof r?.humanReason === "string" ? r.humanReason.trim() : "",
    topics.length ? `Asks about ${topics.join(" and ")}.` : "",
  ].filter(Boolean);
  return {
    reply: reply.slice(0, 2_000),
    needsHuman: modelFlag || topics.length > 0,
    humanReason:
      reasons.join(" ").slice(0, 900) || (modelFlag ? "The model asked for a person." : ""),
  };
}

/** `comment_drafts.error` carries the needs-a-person note behind this prefix. */
export const NEEDS_HUMAN_PREFIX = "needs-human: ";

export function needsHumanNote(error: string | null): string | null {
  return error?.startsWith(NEEDS_HUMAN_PREFIX) ? error.slice(NEEDS_HUMAN_PREFIX.length) : null;
}
