import {
  GoogleGenAI,
  MediaResolution,
  ThinkingLevel,
  type GenerateContentResponse,
} from "@google/genai";
import type { Brand, PostFormat } from "@/db/schema";
import { fakeGeminiClient, fakeGeminiEnabled } from "@/lib/ai-fake";
import {
  costUsdAtRates,
  DEFAULT_MODEL,
  estimateCostUsd,
  GROUNDING_USD_PER_QUERY,
  ideationRates,
  type AnalysisModel,
  type TokenUsage,
} from "@/lib/analysis/pricing";
import type { AnalysisGap, AnalysisHook, AnalysisTimelineEntry } from "@/lib/analysis/contract";
import { ANALYSIS_JSON_SCHEMA, ANALYSIS_SYSTEM_PROMPT } from "@/lib/analysis/prompt";
import {
  ASPECT_RATIOS,
  SCRIPT_BODY_VERSION,
  THUMBNAIL_CONCEPT_COUNT,
  TITLE_OPTION_COUNT,
  validateScriptBody,
  type ScriptBodyV1,
  type ScriptLanguage,
  type ScriptSource,
} from "@/lib/scripts/contract";
import { needsVerification } from "@/lib/scripts/language";
import { assemblePostDraft, type RawPostDraft } from "@/lib/posts/assemble";
import {
  CAROUSEL_SLIDES,
  ENGAGEMENT_MECHANICS,
  MAX_HASHTAGS,
  STORY_STICKERS,
  validatePostDraft,
  type PostDraft,
} from "@/lib/posts/contract";
import { languageName } from "@/lib/posts/guides";
import {
  dispatchSpend,
  markSpendNotDispatched,
  markSpendUncertain,
  recordSpend,
  withSpendCap,
} from "@/lib/spend";
import { aiProvider, runCliJson } from "@/lib/ai-cli";

/**
 * One Gemini client for the whole app — shared by the brand-ideation path
 * (below) and the YouTube analysis/screening pipelines (src/lib/analysis,
 * src/lib/screening), which otherwise would each construct their own SDK
 * client. Lazy so importing this module never requires GEMINI_API_KEY at build
 * time (route analysis during `next build` loads modules without env).
 *
 * PLAN.md §5.O3: this is the one module every paid call goes through, which is
 * what made the Anthropic → Gemini swap one module's job. Keep it that way —
 * a new call site uses the helpers here, never its own client.
 */
let cachedClient: GoogleGenAI | undefined;

/** Drops the cached client so a key saved on the Settings page takes effect without a restart. */
export function resetGeminiClient(): void {
  cachedClient = undefined;
}

export function geminiClient(): GoogleGenAI {
  // The test-double seam (PLAN.md §1.16, §5.O5.1). This is the ONLY thing in
  // this module that knows a fake exists — every helper below, and every caller
  // in src/lib/analysis and src/lib/screening, goes on talking to the SDK's
  // types and never learns the difference. The cast is unavoidable and is the
  // reason the seam is one line: `GoogleGenAI` has private fields, so no
  // structurally-typed stand-in can satisfy it; `FakeGemini` pins its own
  // methods to the SDK's parameter and return types instead.
  //
  // Deliberately ahead of the cache and re-read every call rather than resolved
  // once: a process that has already built a real client must still switch when
  // a test sets the flag, and the alternative — a cached fake outliving the flag
  // — is a live run silently answering from canned data.
  if (fakeGeminiEnabled()) return fakeGeminiClient() as unknown as GoogleGenAI;

  if (!cachedClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      markSpendNotDispatched();
      throw new Error(
        "Missing GEMINI_API_KEY. Create a key at aistudio.google.com/apikey and set it in .env.",
      );
    }
    cachedClient = new GoogleGenAI({ apiKey });
  }
  return cachedClient;
}

/**
 * The ideation seat — the model that has to research, verify and write
 * publishable copy in the brand's own language.
 *
 * Flash, not Pro (Anton's call, 2026-08-29): the Pro tier is currently
 * preview-only, and the work here is grounded writing rather than hard
 * reasoning, which Flash does at roughly a third of Pro's output rate. The
 * research quality is carried by Search grounding, not by the model's own
 * recall, so the tier buys less here than it would elsewhere.
 *
 * Overridable, and the rates for anything it can be set to live in
 * IDEATION_MODEL_RATES (an unlisted model bills at the most expensive rate on
 * file — still the Pro row — so the cap over-counts rather than under-counts).
 */
const MODEL = process.env.GEMINI_MODEL ?? "gemini-3.7-flash";

/**
 * Ceilings this call is allowed to reach — and, because they are ceilings, the
 * numbers the spend estimate is built from (PLAN.md §1.10: this path's cost
 * joins the YouTube half's cap rather than running beside it).
 */
const MAX_OUTPUT_TOKENS = 16_000;

/**
 * Reasoning tokens, which Gemini bills at the output rate and reports
 * separately from the response itself (`thoughtsTokenCount`). Counted in the
 * reservation because a thinking model can spend more on deciding what to write
 * than on writing it, and a reservation that ignored them would hold back less
 * than the call can bill.
 */
const ESTIMATED_THINKING_TOKENS = 8_000;

/**
 * How many Search groundings this call is expected to be worth reserving for.
 *
 * Not a ceiling, unlike the `max_uses` the Anthropic `web_search` tool took:
 * Gemini's Search grounding has no cap parameter, so this is an estimate for
 * the reservation and a line in the prompt, nothing more. What is actually
 * billed comes from the response's own query list (see groundingQueryCount), so
 * a run that searches more than this bills correctly — it just reserved less
 * than it spent, which is the one direction this file otherwise avoids. See
 * KNOWN-ISSUES.md.
 */
const MAX_GROUNDING_QUERIES = 8;

/**
 * The prompt this route sends: brand, portfolio, existing research, and an
 * optional analysis to ground from. Rounded up on purpose — an over-estimate
 * trips the cap early, which is the safe direction for a guard (see the same
 * reasoning in lib/spend.ts).
 *
 * Search results are NOT in this figure, and that is not an omission: Google
 * does not charge for the tokens Grounding with Google Search feeds back into
 * the prompt. They are billed by the query instead.
 */
const PROMPT_OVERHEAD_TOKENS = 4_000;

/**
 * The worst case this call can bill, reserved against the monthly cap before a
 * request is sent. The reservation is released the moment the call returns;
 * what is actually billed is recorded from `usageMetadata` (see
 * generateContentPlan).
 */
export function estimateContentPlanCostUsd(model: string = MODEL): number {
  const tokens = costUsdAtRates(ideationRates(model), {
    inputTokens: PROMPT_OVERHEAD_TOKENS,
    outputTokens: MAX_OUTPUT_TOKENS + ESTIMATED_THINKING_TOKENS,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  });
  return tokens + MAX_GROUNDING_QUERIES * GROUNDING_USD_PER_QUERY;
}

/**
 * What a Gemini response actually used, in the four buckets the schema records
 * and `costUsdAtRates` prices. Every paid path in the app reads its usage
 * through this function, so the mapping from Google's counters to money exists
 * once.
 *
 * Three details decide whether the stored cost matches the bill:
 *
 *  - `promptTokenCount` INCLUDES the cached prefix, unlike the Anthropic field
 *    it replaces. Subtracting `cachedContentTokenCount` is what stops cached
 *    tokens being counted twice.
 *  - `thoughtsTokenCount` is billed at the output rate and is NOT part of
 *    `candidatesTokenCount`. Dropping it would under-report every call on a
 *    thinking model, which is most of them.
 *  - `toolUsePromptTokenCount` is deliberately excluded. The only tool this app
 *    enables is Grounding with Google Search, and Google states that the input
 *    tokens grounding provides are not charged — they are billed per query
 *    instead (GROUNDING_USD_PER_QUERY). Counting them as input would inflate a
 *    grounded run by tens of thousands of tokens it never paid for.
 *
 * Gemini has no cache-write token counter, so that bucket is always 0 here;
 * it stays in the shape because the `analyses` columns still record it.
 */
export function readUsage(response: GenerateContentResponse): TokenUsage {
  const usage = response.usageMetadata;
  if (
    !usage ||
    !Number.isFinite(usage.promptTokenCount) ||
    !Number.isFinite(usage.candidatesTokenCount)
  ) {
    markSpendUncertain();
    throw new Error(
      "The provider did not report usable billing metadata; its cost remains uncertain.",
    );
  }
  const cacheReadTokens = usage?.cachedContentTokenCount ?? 0;
  const promptTokens = usage?.promptTokenCount ?? 0;
  return {
    inputTokens: Math.max(0, promptTokens - cacheReadTokens),
    outputTokens: (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0),
    cacheReadTokens,
    cacheWriteTokens: 0,
  };
}

/**
 * The model's answer, as text.
 *
 * `GenerateContentResponse.text` is a prototype getter, so it only exists on a
 * value the SDK actually instantiated. A batch job's `inlinedResponses` carry
 * responses that have been through JSON, and a plain object with the right
 * fields but no prototype would make this getter `undefined` — which would read
 * as an empty response, mark every analysis in the batch failed, and still bill
 * for it. Falling back to the parts themselves costs one branch and removes
 * that whole failure mode.
 *
 * Thought parts are excluded, matching what the getter does: they are the
 * model's reasoning, not its answer.
 */
export function responseText(response: GenerateContentResponse): string {
  const viaGetter = response.text;
  if (typeof viaGetter === "string") return viaGetter;
  return (response.candidates?.[0]?.content?.parts ?? [])
    .filter((part) => !part.thought && typeof part.text === "string")
    .map((part) => part.text)
    .join("");
}

/**
 * How many Grounding Queries a response issued — the billable unit for Search
 * grounding ($14/1,000, one request can issue several).
 *
 * `webSearchQueries` is per candidate; this app asks for one. A call that
 * grounded nothing has no metadata at all and costs nothing extra, which is why
 * the promote call can share the same cost function.
 */
export function groundingQueryCount(response: GenerateContentResponse): number {
  return response.candidates?.[0]?.groundingMetadata?.webSearchQueries?.length ?? 0;
}

/**
 * What a finished call actually cost: tokens at the given model's rates, plus
 * the per-query grounding fee for however many searches it chose to run (a call
 * with no Search tool grounds nothing and pays nothing for it, which is why the
 * promote call shares this function rather than having its own).
 */
export function messageCostUsd(
  usage: TokenUsage,
  groundingQueries: number,
  model: string = MODEL,
): number {
  return costUsdAtRates(ideationRates(model), usage) + groundingQueries * GROUNDING_USD_PER_QUERY;
}

export type GeneratedIdea = {
  title: string;
  angle: string;
  format: "reel" | "carousel" | "image_post" | "story";
  platform: string;
  draftCopy: string;
  visualNotes?: string;
  citations?: { claim: string; sources: string[] }[];
};

export type GeneratedResearchNote = {
  topic: string;
  summary: string;
  sources: string[];
  relatedBrandIds: string[];
};

/**
 * A stored analysis used as grounding for a generation run (PLAN.md §5.O2.4).
 *
 * The corpus the YouTube half has already paid to read is better evidence than
 * a fresh web search for "what is happening in this niche" — it is what Anton
 * actually watched. Passed as context, not as instructions: the system prompt's
 * verification rule still applies to anything checkable inside it.
 */
export type AnalysisGrounding = {
  videoTitle: string;
  channelTitle?: string | null;
  summary?: string | null;
  takeaways?: string[] | null;
  topics?: string[] | null;
  ideas?: { title?: string; premise?: string; why_now?: string }[] | null;
};

export type GenerateResult = {
  ideas: GeneratedIdea[];
  researchNotes: GeneratedResearchNote[];
  /** What this call billed, already written to `spend_log`. */
  costUsd: number;
};

/**
 * The content plan's shape, as JSON Schema.
 *
 * Ported field for field from the Anthropic tool definition this replaces
 * (PLAN.md §5.O3.5). It is a response schema rather than a function
 * declaration because Gemini 3 constrains structured output directly, and does
 * so alongside Search grounding in the same request — which removes the failure
 * mode the tool version had, where a model could research and then answer in
 * prose without ever calling the tool.
 */
const IDEAS_JSON_SCHEMA = {
  type: "object",
  properties: {
    researchNotes: {
      type: "array",
      description:
        "Research findings worth sharing with OTHER brands too (e.g. a market/law/news item relevant beyond this one brand). Omit if nothing found is cross-brand relevant.",
      items: {
        type: "object",
        properties: {
          topic: { type: "string" },
          summary: { type: "string" },
          sources: { type: "array", items: { type: "string" } },
          relatedBrandIds: {
            type: "array",
            items: { type: "string" },
            description:
              "Brand ids (from the provided list) this topic is relevant to, including this brand.",
          },
        },
        required: ["topic", "summary", "sources", "relatedBrandIds"],
      },
    },
    ideas: {
      type: "array",
      minItems: 5,
      maxItems: 10,
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          angle: { type: "string", description: "Why this idea, the hook, one or two sentences." },
          format: { type: "string", enum: ["reel", "carousel", "image_post", "story"] },
          platform: {
            type: "string",
            description: "One of the brand's platforms this is written for.",
          },
          draftCopy: {
            type: "string",
            description:
              "The FULL ready-to-post caption in the brand's voice/language: hook line, body, call-to-action, hashtags. Not a placeholder or summary — actual publishable text.",
          },
          visualNotes: {
            type: "string",
            description:
              "Optional: what the accompanying photo/video should show, for whoever shoots or designs it.",
          },
          citations: {
            type: "array",
            description:
              "Required if the idea rests on a factual/verifiable claim (a law, price, program name, statistic). Each claim needs at least 2 independent sources.",
            items: {
              type: "object",
              properties: {
                claim: { type: "string" },
                sources: { type: "array", items: { type: "string" }, minItems: 2 },
              },
              required: ["claim", "sources"],
            },
          },
        },
        required: ["title", "angle", "format", "platform", "draftCopy"],
      },
    },
  },
  required: ["ideas"],
} as const;

export async function generateContentPlan(
  brand: Brand,
  allBrands: Brand[],
  existingResearch: { topic: string; summary: string }[],
  grounding?: AnalysisGrounding | null,
  options: { topic?: string | null } = {},
): Promise<GenerateResult> {
  const otherBrandList = allBrands
    .filter((b) => b.id !== brand.id)
    .map((b) => `- ${b.id}: ${b.name} (${b.niche}, market: ${b.market})`)
    .join("\n");

  const researchContext = existingResearch.length
    ? `\n\nExisting shared research already on file that may be relevant — reuse it instead of re-researching if it fits:\n${existingResearch
        .map((r) => `- ${r.topic}: ${r.summary}`)
        .join("\n")}`
    : "";

  const groundingContext = grounding
    ? `\n\nGROUNDING — a video from this portfolio's own research corpus, already analysed. Build the ideas from THIS material first; use web search only to verify facts in it or to fill a gap it leaves.
Video: ${grounding.videoTitle}${grounding.channelTitle ? ` (${grounding.channelTitle})` : ""}
${grounding.summary ? `Summary: ${grounding.summary}\n` : ""}${
        grounding.takeaways?.length
          ? `Takeaways:\n${grounding.takeaways.map((t) => `- ${t}`).join("\n")}\n`
          : ""
      }${grounding.topics?.length ? `Topics: ${grounding.topics.join(", ")}\n` : ""}${
        grounding.ideas?.length
          ? `Ideas the analysis already proposed (adapt for THIS brand, do not copy):\n${grounding.ideas
              .map((i) => `- ${[i.title, i.premise, i.why_now].filter(Boolean).join(" — ")}`)
              .join("\n")}\n`
          : ""
      }`
    : "";

  // Topic-first research (PLAN.md §5.O11.4): the owner names what to research
  // and every idea is about it. Still grounded the same way, still this brand.
  const topic = options.topic?.trim();
  const topicContext = topic
    ? `\n\nTOPIC — the owner picked this topic. Research it for this brand's audience and market; every idea must be about it:\n${topic}`
    : "";

  const system = `You are a social media researcher and copywriter for a portfolio of small businesses in Paraguay and abroad. Your job for each brand is to: (1) research current, real, relevant trends/news/topics for its niche and market using Google Search, (2) turn that research into concrete content ideas, and (3) write full, ready-to-post captions for each idea — not placeholders. Copy must be in the brand's own language and voice. Never invent facts, prices, laws, or statistics — verify anything checkable with at least 2 independent web sources and attach them as citations. If you can't verify a claim, drop it or write around it instead of guessing. If research surfaces something relevant to OTHER brands in the portfolio too, report it as a shared research note so it isn't re-researched per brand. Every search costs money: use at most ${MAX_GROUNDING_QUERIES} searches, and make them count. Answer with JSON matching the required schema and nothing else.`;

  const userPrompt = `Brand: ${brand.name} (id: ${brand.id})
Niche: ${brand.niche}
Market: ${brand.market}
Language for copy: ${brand.language}
Voice: ${brand.voice ?? "no voice notes on file — write in a plain, concrete house voice"}
Platforms: ${brand.platforms.join(", ")}

Other brands in this portfolio (for cross-brand research notes only — do not write ideas for them):
${otherBrandList}
${researchContext}${groundingContext}${topicContext}

${topic ? "Research this topic for this brand's niche and market" : "Research current trends/news relevant to this brand's niche and market"}, then propose 5-10 concrete content ideas with full ready-to-post copy.`;

  // The whole paid call sits inside the cap: the estimate is held against the
  // monthly budget before the request goes out, and the real figure is logged
  // as soon as it comes back — the same shape the analysis pipeline uses, so
  // both halves of the app share one budget rather than one each (PLAN.md
  // §1.10). Streaming, because 16k output tokens plus reasoning on a Pro model
  // is a long time to hold a request open with nothing coming back.
  const { text, costUsd, finishReason } = await withSpendCap(
    estimateContentPlanCostUsd(),
    async () => {
      const stream = await dispatchSpend(() =>
        geminiClient().models.generateContentStream({
          model: MODEL,
          contents: userPrompt,
          config: {
            systemInstruction: system,
            maxOutputTokens: MAX_OUTPUT_TOKENS,
            // Gemini 3 allows a built-in tool and structured output in the same
            // request, which is what makes this one call rather than two.
            tools: [{ googleSearch: {} }],
            responseMimeType: "application/json",
            responseJsonSchema: IDEAS_JSON_SCHEMA,
          },
        }),
      );

      let body = "";
      let usage: TokenUsage | null = null;
      let stopReason: string | undefined;
      let queries = 0;
      const seenQueries = new Set<string>();

      for await (const chunk of stream) {
        body += responseText(chunk);
        // Usage arrives cumulatively, with the totals on the final chunk that
        // carries it; the last one seen is therefore the whole call.
        if (chunk.usageMetadata) usage = readUsage(chunk);
        const candidate = chunk.candidates?.[0];
        if (candidate?.finishReason) stopReason = candidate.finishReason;
        // Whether grounding metadata arrives once with every query or is split
        // across chunks is not documented either way, so count it both ways and
        // bill the larger: over-counting a $0.014 query is survivable, silently
        // dropping one from the ledger is the thing this file exists to prevent.
        const chunkQueries = candidate?.groundingMetadata?.webSearchQueries ?? [];
        for (const q of chunkQueries) seenQueries.add(q);
        queries = Math.max(queries, chunkQueries.length, seenQueries.size);
      }

      // A call that produced output but reported no usage must not be recorded
      // as free — that is the silent under-report the cap cannot survive. Bill
      // the reservation instead, which is the figure already held against the
      // budget, and say so.
      if (!usage) {
        console.warn(
          "Gemini returned no usageMetadata for a content plan; billing the reservation estimate instead.",
        );
        const fallback = estimateContentPlanCostUsd();
        markSpendUncertain();
        return { text: body, costUsd: fallback, finishReason: stopReason };
      }

      // Billed whether or not the response parses below: the tokens were spent.
      const cost = messageCostUsd(usage, queries);
      await recordSpend(cost);
      return { text: body, costUsd: cost, finishReason: stopReason };
    },
  );

  let input: { ideas?: GeneratedIdea[]; researchNotes?: GeneratedResearchNote[] };
  try {
    input = JSON.parse(text) as typeof input;
  } catch {
    throw new Error(
      `Gemini didn't return a parseable content plan (finish reason: ${finishReason ?? "unknown"}). Try again.`,
    );
  }
  if (!Array.isArray(input.ideas) || input.ideas.length === 0) {
    throw new Error(
      `Gemini returned no ideas (finish reason: ${finishReason ?? "unknown"}). Try again.`,
    );
  }

  return { ideas: input.ideas, researchNotes: input.researchNotes ?? [], costUsd };
}

// ---------------------------------------------------------------------------
// promote — adapting one unit of an analysis into a brand's voice
// ---------------------------------------------------------------------------

/**
 * The cheap model. Promoting rewrites one paragraph in a known voice from
 * material that is already on file — no research, no judgement about what is
 * true, nothing the analysis pipeline's own default model cannot do (PLAN.md
 * §5.O2.3 calls for "one cheap call"). Overridable for the same reason
 * GEMINI_MODEL is.
 */
const PROMOTE_MODEL = process.env.GEMINI_PROMOTE_MODEL ?? "gemini-3.1-flash-lite";

/** Enough for a caption with hashtags, not enough for an essay. */
const PROMOTE_MAX_TOKENS = 2_000;
const PROMOTE_PROMPT_OVERHEAD_TOKENS = 1_500;

export type AdaptedIdea = {
  title: string;
  angle: string;
  draftCopy: string;
  visualNotes?: string;
};

export type AdaptIdeaInput = {
  /** What was marked or proposed, as it reads in the analysis. */
  sourceText: string;
  /** Where it came from, for the angle line. */
  videoTitle: string;
  format: string;
  platform: string;
};

/** Ported field for field from the Anthropic `submit_adapted_idea` tool. */
const ADAPT_JSON_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "Short internal name for the idea." },
    angle: {
      type: "string",
      description: "Why this works for THIS brand's audience, one or two sentences.",
    },
    draftCopy: {
      type: "string",
      description:
        "The FULL ready-to-post caption in the brand's language and voice: hook line, body, call-to-action, hashtags. Actual publishable text, not a summary.",
    },
    visualNotes: {
      type: "string",
      description: "Optional: what the photo/video should show.",
    },
  },
  required: ["title", "angle", "draftCopy"],
} as const;

export function estimateAdaptCostUsd(model: string = PROMOTE_MODEL): number {
  return costUsdAtRates(ideationRates(model), {
    inputTokens: PROMOTE_PROMPT_OVERHEAD_TOKENS,
    outputTokens: PROMOTE_MAX_TOKENS,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  });
}

/**
 * Rewrite one piece of an analysis as a post for a brand — the paid half of
 * the promote endpoint, and optional per request: promoting verbatim must
 * work at zero cost (§5.O2.3).
 *
 * No Search grounding on purpose. The source material is already on file and
 * already paid for; grounding here would turn a $0.001 call into a $0.10 one
 * and re-open the verification question the analysis already answered.
 */
export async function adaptIdeaToBrand(
  brand: Brand,
  input: AdaptIdeaInput,
): Promise<{ idea: AdaptedIdea; costUsd: number }> {
  const system = `You adapt research findings into ready-to-post social copy for one specific brand. Write in the brand's language and voice. Never invent facts, prices, laws or statistics that are not in the source material — if the source does not support a claim, write around it. Answer with JSON matching the required schema and nothing else.`;

  const userPrompt = `Brand: ${brand.name} (${brand.niche})
Market: ${brand.market}
Language for copy: ${brand.language}
Voice: ${brand.voice ?? "plain, concrete, no hype"}
Format: ${input.format}
Platform: ${input.platform}

Source material, from an analysis of "${input.videoTitle}":
${input.sourceText}

Adapt it into one post for this brand.`;

  return withSpendCap(estimateAdaptCostUsd(), async () => {
    const response = await dispatchSpend(() =>
      geminiClient().models.generateContent({
        model: PROMOTE_MODEL,
        contents: userPrompt,
        config: {
          systemInstruction: system,
          maxOutputTokens: PROMOTE_MAX_TOKENS,
          // One paragraph rewritten from material already on file is not a
          // reasoning problem, and reasoning tokens bill at the output rate —
          // the same call the Anthropic version made by not asking for thinking
          // at all.
          thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
          responseMimeType: "application/json",
          responseJsonSchema: ADAPT_JSON_SCHEMA,
        },
      }),
    );

    const costUsd = messageCostUsd(
      readUsage(response),
      groundingQueryCount(response),
      PROMOTE_MODEL,
    );
    await recordSpend(costUsd);

    const raw = responseText(response);
    let idea: AdaptedIdea;
    try {
      idea = JSON.parse(raw) as AdaptedIdea;
    } catch {
      throw new Error(
        `The model returned no adapted idea (finish reason: ${
          response.candidates?.[0]?.finishReason ?? "unknown"
        }).`,
      );
    }

    return { idea, costUsd };
  });
}

// ---------------------------------------------------------------------------
// no-captions fallback — analysing a YouTube video from the video itself
// ---------------------------------------------------------------------------

/**
 * Longest video the fallback will send (PLAN.md §1.35). Past this, one click
 * buys well over half a million input tokens; a video that long wants a
 * deliberate decision, not a button.
 */
export const VIDEO_URL_MAX_SECONDS = 90 * 60;

/**
 * Input tokens per second of video at LOW media resolution: ~70 per sampled
 * frame at 1 fps plus 32 for the audio track, rounded up — an estimate that
 * runs high trips the cap early, the safe direction. Unmeasured until the live
 * smoke runs this path (§1.17); re-baseline it from that run's usage.
 */
const VIDEO_TOKENS_PER_SECOND = 110;

/** Title/channel framing plus the analysis system prompt. */
const VIDEO_PROMPT_OVERHEAD_TOKENS = 1_500;

/** The analysis pipeline's own output ceiling (src/lib/analysis/run.ts). */
const VIDEO_MAX_OUTPUT_TOKENS = 8_000;

export class VideoUrlAnalysisRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VideoUrlAnalysisRefusedError";
  }
}

/**
 * The worst case a video-URL analysis of `durationSeconds` can bill, reserved
 * against the cap before the call. Throws when the duration is unknown or past
 * VIDEO_URL_MAX_SECONDS — both are refusals, not estimates.
 */
export function estimateVideoUrlAnalysisCostUsd(
  durationSeconds: number | null | undefined,
  model: AnalysisModel = DEFAULT_MODEL,
): number {
  if (!durationSeconds || durationSeconds <= 0) {
    throw new VideoUrlAnalysisRefusedError(
      "This video's duration is unknown, so its cost cannot be estimated. Re-ingest it to fetch its metadata first.",
    );
  }
  if (durationSeconds > VIDEO_URL_MAX_SECONDS) {
    throw new VideoUrlAnalysisRefusedError(
      `This video is ${Math.round(durationSeconds / 60)} minutes long; the no-captions analysis stops at ${
        VIDEO_URL_MAX_SECONDS / 60
      } minutes.`,
    );
  }
  return estimateCostUsd(model, {
    inputTokens:
      Math.ceil(durationSeconds * VIDEO_TOKENS_PER_SECOND) + VIDEO_PROMPT_OVERHEAD_TOKENS,
    outputTokens: VIDEO_MAX_OUTPUT_TOKENS,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  });
}

export type VideoUrlAnalysisInput = {
  youtubeUrl: string;
  durationSeconds: number | null;
  title: string;
  channelTitle: string | null;
  model?: AnalysisModel;
};

/** What the Gemini call produced, handed to the caller's `store` inside the cap. */
export type VideoUrlAnalysisOutcome =
  | { ok: true; response: GenerateContentResponse; model: AnalysisModel }
  | { ok: false; error: string; model: AnalysisModel };

/**
 * Analyse a YouTube video from its URL, with no transcript (PLAN.md §1.35):
 * Gemini watches the video (`fileData.fileUri`, LOW media resolution) and
 * answers in the same schema as the caption path.
 *
 * Click-only by design — the one caller is `src/lib/analysis/fallback.ts`, and
 * nothing in poll or batch may reach it. `store` runs inside `withSpendCap`, so
 * the analysis row (and the `recordSpend` that `insertAnalysis` does) lands
 * before the reservation is released — this function records no spend itself,
 * which is what keeps the call from being billed twice.
 */
export async function analyzeVideoUrl<T>(
  input: VideoUrlAnalysisInput,
  store: (outcome: VideoUrlAnalysisOutcome) => Promise<T>,
): Promise<T> {
  const model = input.model ?? DEFAULT_MODEL;
  const estimate = estimateVideoUrlAnalysisCostUsd(input.durationSeconds, model);
  const meta = [
    `Title: ${input.title}`,
    input.channelTitle ? `Channel: ${input.channelTitle}` : null,
    `Duration: ${Math.round((input.durationSeconds ?? 0) / 60)} min`,
  ]
    .filter(Boolean)
    .join("\n");

  return withSpendCap(estimate, async () => {
    let response: GenerateContentResponse;
    try {
      response = await dispatchSpend(() =>
        geminiClient().models.generateContent({
          model,
          contents: [
            {
              role: "user",
              parts: [
                { fileData: { fileUri: input.youtubeUrl } },
                {
                  text: `${meta}\n\nThis video has no captions, so there is no transcript: the video itself is attached. Analyse what is said and shown in it exactly as you would a transcript. Timestamps refer to the video.`,
                },
              ],
            },
          ],
          config: {
            systemInstruction: ANALYSIS_SYSTEM_PROMPT,
            maxOutputTokens: VIDEO_MAX_OUTPUT_TOKENS,
            // Low resolution is the whole cost model (§1.35): the analysis is
            // about what is said and the structure, not fine visual detail.
            mediaResolution: MediaResolution.MEDIA_RESOLUTION_LOW,
            thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
            responseMimeType: "application/json",
            responseJsonSchema: ANALYSIS_JSON_SCHEMA,
          },
        }),
      );
    } catch (err) {
      return store({ ok: false, error: err instanceof Error ? err.message : String(err), model });
    }
    return store({ ok: true, response, model });
  });
}

// ---------------------------------------------------------------------------
// titles + on-camera scripts (PLAN.md §1.32–§1.33, §5.O8)
// ---------------------------------------------------------------------------

/** Ten titles and an angle each: a short answer, no research. */
const TITLES_MAX_OUTPUT_TOKENS = 3_000;
const TITLES_THINKING_TOKENS = 2_000;
/** Brand, topic, style guide and up to a few dozen saved lessons. */
const TITLES_PROMPT_OVERHEAD_TOKENS = 4_000;
/**
 * One structured-JSON request, routed by `AI_PROVIDER` (§1.38). "gemini" (the
 * default) bills through the API under the spend cap; "claude-cli" and
 * "codex-cli" run the logged-in CLI on this PC under Anton's subscription and
 * cost the app nothing. Studio features (titles, scripts, reports, packs) use
 * this; the YouTube batch pipeline stays on Gemini, where volume is.
 */
export async function structuredJson(opts: {
  system: string;
  prompt: string;
  schema: unknown;
  webSearch: boolean;
  estimateUsd: number;
  maxOutputTokens: number;
  thinkingLow?: boolean;
}): Promise<{ text: string; costUsd: number; groundingQueries: number; finishReason?: string }> {
  const provider = aiProvider();
  if (provider !== "gemini") {
    const text = await runCliJson({
      provider,
      system: opts.system,
      prompt: opts.prompt,
      schema: opts.schema,
      webSearch: opts.webSearch,
    });
    return { text, costUsd: 0, groundingQueries: 0, finishReason: provider };
  }
  return withSpendCap(opts.estimateUsd, async () => {
    const response = await dispatchSpend(() =>
      geminiClient().models.generateContent({
        model: MODEL,
        contents: opts.prompt,
        config: {
          systemInstruction: opts.system,
          maxOutputTokens: opts.maxOutputTokens,
          ...(opts.thinkingLow ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } } : {}),
          ...(opts.webSearch ? { tools: [{ googleSearch: {} }] } : {}),
          responseMimeType: "application/json",
          responseJsonSchema: opts.schema,
        },
      }),
    );
    const queries = groundingQueryCount(response);
    const cost = messageCostUsd(readUsage(response), queries);
    await recordSpend(cost);
    return {
      text: responseText(response),
      costUsd: cost,
      groundingQueries: queries,
      finishReason: response.candidates?.[0]?.finishReason,
    };
  });
}

export const TITLE_SUGGESTION_COUNT = 10;

/**
 * A 20-minute script is ~3,000 spoken words plus shot prompts and sources —
 * roughly 8k tokens; the ceiling leaves room for that twice over.
 */
const SCRIPT_MAX_OUTPUT_TOKENS = 16_000;
const SCRIPT_THINKING_TOKENS = 8_000;
/** Style guide + structure references + lessons. Rounded up (see PROMPT_OVERHEAD_TOKENS). */
const SCRIPT_PROMPT_OVERHEAD_TOKENS = 8_000;
const SCRIPT_MAX_GROUNDING_QUERIES = 8;

/** Spoken words per minute on camera — a calm explainer pace. */
const WORDS_PER_MINUTE = 140;

export function estimateTitlesCostUsd(model: string = MODEL): number {
  return costUsdAtRates(ideationRates(model), {
    inputTokens: TITLES_PROMPT_OVERHEAD_TOKENS,
    outputTokens: TITLES_MAX_OUTPUT_TOKENS + TITLES_THINKING_TOKENS,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  });
}

export function estimateScriptCostUsd(model: string = MODEL): number {
  const tokens = costUsdAtRates(ideationRates(model), {
    inputTokens: SCRIPT_PROMPT_OVERHEAD_TOKENS,
    outputTokens: SCRIPT_MAX_OUTPUT_TOKENS + SCRIPT_THINKING_TOKENS,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  });
  return tokens + SCRIPT_MAX_GROUNDING_QUERIES * GROUNDING_USD_PER_QUERY;
}

/** A saved lesson handed to the prompt (§1.31): hooks and title patterns for titles, facts for scripts. */
export type PromptLesson = {
  kind: string;
  text: string;
  sourceUrl?: string | null;
};

/**
 * A competitor video's analysis, passed as a *structure* reference: how it
 * hooks, how it is paced, what it leaves out. Its wording is never passed on
 * to be reused — the prompt forbids copying it — which is why the summary and
 * takeaways are deliberately not in this type.
 */
export type StructureReference = {
  videoTitle: string;
  channelTitle?: string | null;
  hook?: AnalysisHook | null;
  timeline?: AnalysisTimelineEntry[] | null;
  gaps?: AnalysisGap[] | null;
};

export type TitleSuggestion = { title: string; angle: string };

export const TITLES_JSON_SCHEMA = {
  type: "object",
  properties: {
    titles: {
      type: "array",
      minItems: TITLE_SUGGESTION_COUNT,
      maxItems: TITLE_SUGGESTION_COUNT,
      items: {
        type: "object",
        properties: {
          title: { type: "string", description: "A YouTube title, under 70 characters." },
          angle: {
            type: "string",
            description: "Why a viewer clicks: the promise or tension, one sentence.",
          },
        },
        required: ["title", "angle"],
      },
    },
  },
  required: ["titles"],
} as const;

function lessonLines(lessons: PromptLesson[]): string {
  return lessons
    .map((l) => `- [${l.kind}] ${l.text}${l.sourceUrl ? ` (source: ${l.sourceUrl})` : ""}`)
    .join("\n");
}

const LANGUAGE_NAMES: Record<ScriptLanguage, string> = {
  en: "English",
  "es-PY": "Paraguayan Spanish (castellano paraguayo, voseo)",
  jopara: "Jopara (Paraguayan Spanish with common Guaraní words mixed in)",
};

function styleBlock(language: ScriptLanguage, styleGuide: string): string {
  return `Language: ${LANGUAGE_NAMES[language]}.${
    styleGuide.trim() ? `\n\nSTYLE GUIDE — follow it:\n${styleGuide.trim()}` : ""
  }`;
}

/**
 * Ten title options for a video on `topic`, each with its angle (§5.O8.3).
 * Ungrounded: a title is a promise about a video that does not exist yet, and
 * the facts it rests on are checked when the script is written.
 */
export async function generateTitles(
  brand: Brand,
  topic: string,
  lessons: PromptLesson[],
  options: { language: ScriptLanguage; styleGuide: string },
): Promise<{ titles: TitleSuggestion[]; costUsd: number }> {
  const system = `You write YouTube titles for a creator who films himself explaining things on camera. A good title makes one concrete promise, names the viewer's situation, and is under 70 characters. No clickbait the video cannot pay off, no ALL CAPS, no emoji. Never invent numbers, laws or prices in a title. Write every title in the requested language. Answer with JSON matching the required schema and nothing else.`;

  const userPrompt = `Brand: ${brand.name} (${brand.niche}), market: ${brand.market}
Voice: ${brand.voice ?? "plain, concrete, no hype"}
${styleBlock(options.language, options.styleGuide)}

Topic: ${topic}
${
  lessons.length
    ? `\nWhat Anton has saved about hooks and titles that worked — use the PATTERNS, never copy a title word for word:\n${lessonLines(lessons)}\n`
    : ""
}
Propose ${TITLE_SUGGESTION_COUNT} distinct titles, each with its angle. Vary the approach: a number, a mistake to avoid, a question, a before/after, a direct promise.`;

  const { text, costUsd, finishReason } = await structuredJson({
    system,
    prompt: userPrompt,
    schema: TITLES_JSON_SCHEMA,
    webSearch: false,
    estimateUsd: estimateTitlesCostUsd(),
    maxOutputTokens: TITLES_MAX_OUTPUT_TOKENS,
    thinkingLow: true,
  });
  {
    let parsed: { titles?: TitleSuggestion[] };
    try {
      parsed = JSON.parse(text) as typeof parsed;
    } catch {
      throw new Error(
        `The model didn't return parseable titles (finish reason: ${finishReason ?? "unknown"}). Try again.`,
      );
    }
    const titles = (parsed.titles ?? []).filter((t) => t?.title?.trim());
    if (titles.length === 0) throw new Error("The model returned no titles. Try again.");
    return { titles, costUsd };
  }
}

const BROLL_JSON_SCHEMA = {
  type: "object",
  properties: {
    spokenLine: {
      type: "string",
      description: "The exact spoken line (copied from spokenLines) this shot plays under.",
    },
    description: {
      type: "string",
      description: "What the shot shows, in a few words, in English.",
    },
    imagePrompt: {
      type: "string",
      description:
        "An English prompt for an image model: subject, setting, light, camera, style. Photographic, no text in the image, no real people's likenesses.",
    },
    videoPrompt: {
      type: "string",
      description:
        "An English image-to-video prompt describing the motion (camera move, what moves), or an empty string if the shot is a still.",
    },
    aspectRatio: { type: "string", enum: [...ASPECT_RATIOS] },
  },
  required: ["spokenLine", "description", "imagePrompt", "videoPrompt", "aspectRatio"],
} as const;

const SPOKEN_LINES_SCHEMA = {
  type: "array",
  items: { type: "string" },
  description: "Teleprompter lines: one short sentence, one idea per line.",
} as const;

export const SCRIPT_JSON_SCHEMA = {
  type: "object",
  properties: {
    titleOptions: {
      type: "array",
      minItems: TITLE_OPTION_COUNT,
      maxItems: TITLE_OPTION_COUNT,
      description: "The chosen title first, then two alternatives.",
      items: {
        type: "object",
        properties: { title: { type: "string" }, angle: { type: "string" } },
        required: ["title", "angle"],
      },
    },
    thumbnailConcepts: {
      type: "array",
      minItems: THUMBNAIL_CONCEPT_COUNT,
      maxItems: THUMBNAIL_CONCEPT_COUNT,
      items: {
        type: "object",
        properties: {
          description: { type: "string" },
          textOverlay: { type: "string", description: "At most 4 words, or empty." },
          imagePrompt: {
            type: "string",
            description: "English image prompt, no text in the image.",
          },
        },
        required: ["description", "textOverlay", "imagePrompt"],
      },
    },
    hook: {
      type: "object",
      properties: {
        spokenLines: SPOKEN_LINES_SCHEMA,
        onScreenText: { type: "array", items: { type: "string" } },
        broll: { type: "array", items: BROLL_JSON_SCHEMA },
      },
      required: ["spokenLines", "onScreenText", "broll"],
    },
    sections: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        properties: {
          heading: { type: "string" },
          spokenLines: SPOKEN_LINES_SCHEMA,
          talkingPoints: {
            type: "array",
            items: { type: "string" },
            description: "Notes for the presenter, not read aloud.",
          },
          onScreenText: { type: "array", items: { type: "string" } },
          broll: { type: "array", items: BROLL_JSON_SCHEMA },
          sourceIds: {
            type: "array",
            items: { type: "string" },
            description: "Ids from `sources` for every factual claim made in this section.",
          },
        },
        required: ["heading", "spokenLines", "talkingPoints", "onScreenText", "broll", "sourceIds"],
      },
    },
    cta: {
      type: "object",
      properties: {
        spokenLines: SPOKEN_LINES_SCHEMA,
        onScreenText: { type: "array", items: { type: "string" } },
      },
      required: ["spokenLines", "onScreenText"],
    },
    sources: {
      type: "array",
      description:
        "One entry per factual claim in the script. Every entry has a real URL you found by searching.",
      items: {
        type: "object",
        properties: {
          id: { type: "string", description: "s1, s2, ..." },
          claim: { type: "string" },
          url: {
            type: "string",
            description: "The full https URL of the page that states this claim.",
          },
          title: { type: "string", description: "Page or publisher name." },
          verifyBeforeRecording: {
            type: "boolean",
            description:
              "true for anything legal, residency/migration, tax, price, fee or deadline related — facts that change and that viewers act on.",
          },
        },
        required: ["id", "claim", "url", "title", "verifyBeforeRecording"],
      },
    },
  },
  required: ["titleOptions", "thumbnailConcepts", "hook", "sections", "cta", "sources"],
} as const;

export type ScriptBrief = {
  topic: string;
  /** The title picked from `generateTitles`, or typed by hand. */
  title: string;
  targetMinutes: number;
  language: ScriptLanguage;
  /** The whole `content/style/<language>.md` file. */
  styleGuide: string;
  references: StructureReference[];
  lessons: PromptLesson[];
  /** The brand's fact sheet (build 2b, idea 3). Optional: a brief without one reads as none. */
  facts?: PromptFact[];
};

/** A checked fact from the brand's fact sheet: said as-is, cited by its URL. */
export type PromptFact = {
  topic: string;
  claim: string;
  sourceUrl: string | null;
};

function factsBlock(facts: PromptFact[] | undefined): string {
  if (!facts?.length) return "";
  const lines = facts.map(
    (f) =>
      `- [${f.topic}] ${f.claim}${f.sourceUrl ? ` (source: ${f.sourceUrl})` : " (no source URL on file)"}`,
  );
  return `\n\nFACTS — Anton's checked fact sheet for this brand. Use these checked facts as-is (do not reword numbers, dates or names) and cite their URL in "sources" when you use one. A fact not listed here — or listed with no source URL on file — still needs its own source:\n${lines.join("\n")}`;
}

function referenceBlock(refs: StructureReference[]): string {
  if (!refs.length) return "";
  const parts = refs.map((r, i) => {
    const lines = [
      `Reference ${i + 1}: "${r.videoTitle}"${r.channelTitle ? ` (${r.channelTitle})` : ""}`,
    ];
    if (r.hook)
      lines.push(`  Hook technique: ${r.hook.technique} — why it works: ${r.hook.why_it_works}`);
    if (r.timeline?.length) {
      lines.push(`  Structure: ${r.timeline.map((t) => `${t.ts} ${t.topic}`).join(" → ")}`);
    }
    if (r.gaps?.length) lines.push(`  What it leaves out: ${r.gaps.map((g) => g.gap).join("; ")}`);
    return lines.join("\n");
  });
  return `\n\nSTRUCTURE REFERENCES — competitor videos on this topic, already analysed. Learn from HOW they are built (hook technique, order of beats, pacing) and cover what they leave out. Do NOT copy their wording, their titles, their examples or their jokes; every sentence in this script is new.\n${parts.join("\n")}`;
}

/** What the model returns: the body minus the fields this app fills in itself. */
type RawScript = Omit<
  ScriptBodyV1,
  | "version"
  | "language"
  | "topic"
  | "chosenTitle"
  | "targetMinutes"
  | "sources"
  | "hook"
  | "sections"
> & {
  hook: Omit<ScriptBodyV1["hook"], "broll"> & { broll: RawBroll[] };
  sections: (Omit<ScriptBodyV1["sections"][number], "broll"> & { broll: RawBroll[] })[];
  sources: ScriptSource[];
};
type RawBroll = Omit<ScriptBodyV1["hook"]["broll"][number], "videoPrompt"> & {
  videoPrompt: string | null;
};

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const { protocol } = new URL(value);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * Turn the model's answer into a contract body. Pure, so it is unit-tested.
 *
 * Repairs rather than rejects the two things a model gets wrong that are
 * cheaper to fix than to pay for again, and never hides either:
 *  - a source without a usable URL is dropped from `sources`, and every
 *    section that cited it gets an "UNSOURCED — verify or cut" talking point;
 *  - a `sourceIds` entry naming no source is dropped.
 * The verify flag is the model's OR `needsVerification`'s (§5.O8: legal and
 * residency facts always carry it).
 */
export function assembleScriptBody(
  raw: RawScript,
  brief: Pick<ScriptBrief, "topic" | "title" | "targetMinutes" | "language">,
): ScriptBodyV1 {
  const kept = new Map<string, ScriptSource>();
  const dropped = new Map<string, string>();
  for (const s of raw.sources ?? []) {
    const id = String(s.id ?? "").trim();
    if (!id || kept.has(id)) continue;
    if (!isHttpUrl(s.url)) {
      dropped.set(id, s.claim);
      continue;
    }
    kept.set(id, {
      id,
      claim: s.claim,
      url: s.url,
      title: s.title ?? "",
      verifyBeforeRecording: needsVerification(s.claim ?? "", s.verifyBeforeRecording === true),
    });
  }

  const broll = (shots: RawBroll[]) =>
    (shots ?? []).map((b) => ({
      spokenLine: b.spokenLine,
      description: b.description,
      imagePrompt: b.imagePrompt,
      videoPrompt: b.videoPrompt?.trim() ? b.videoPrompt.trim() : null,
      aspectRatio: b.aspectRatio,
    }));

  return {
    version: SCRIPT_BODY_VERSION,
    language: brief.language,
    topic: brief.topic,
    chosenTitle: brief.title,
    targetMinutes: brief.targetMinutes,
    titleOptions: raw.titleOptions,
    thumbnailConcepts: raw.thumbnailConcepts,
    hook: {
      spokenLines: raw.hook.spokenLines,
      onScreenText: raw.hook.onScreenText,
      broll: broll(raw.hook.broll),
    },
    sections: raw.sections.map((s) => ({
      heading: s.heading,
      spokenLines: s.spokenLines,
      talkingPoints: [
        ...s.talkingPoints,
        ...s.sourceIds
          .filter((id) => dropped.has(id))
          .map((id) => `UNSOURCED — verify or cut: ${dropped.get(id)}`),
      ],
      onScreenText: s.onScreenText,
      broll: broll(s.broll),
      sourceIds: [...new Set(s.sourceIds.filter((id) => kept.has(id)))],
    })),
    cta: raw.cta,
    sources: [...kept.values()],
  };
}

export class ScriptGenerationError extends Error {
  constructor(
    message: string,
    readonly errors: string[] = [],
  ) {
    super(message);
    this.name = "ScriptGenerationError";
  }
}

/**
 * Write an on-camera script (§1.32, §5.O8.3): Search-grounded, every factual
 * claim in `sources` with a URL, in the brief's language and style guide,
 * built on the structure references without copying them. Returns a body the
 * contract accepts, or throws `ScriptGenerationError` — after billing, since
 * the tokens were spent either way.
 */
export async function generateScript(
  brand: Brand,
  brief: ScriptBrief,
): Promise<{ body: ScriptBodyV1; costUsd: number; groundingQueries: number }> {
  const words = Math.round(brief.targetMinutes * WORDS_PER_MINUTE);

  const system = `You write on-camera YouTube scripts for Anton, who films himself and reads from a teleprompter. Spoken lines are short: one sentence, one idea per line, words a person actually says out loud. No filler ("in today's video", "without further ado"), no hype, no stage directions inside spoken lines.

Facts: research the topic with Google Search. Every factual claim — a law, a rule, a price, a fee, a deadline, a statistic, a named program — must appear in "sources" with the full URL of a page that states it, and the section that makes the claim lists that source id. If you cannot find a source for a claim, do not make the claim. Mark legal, residency, migration, tax, price and deadline facts verifyBeforeRecording: true. Every search costs money: use at most ${SCRIPT_MAX_GROUNDING_QUERIES} searches.

B-roll: for each section, 1-3 shots that illustrate a specific spoken line. Image and video prompts are always in English, photographic, with no text in the image and no real people's likenesses. Leave videoPrompt empty for a still.

Answer with JSON matching the required schema and nothing else.`;

  const userPrompt = `Brand: ${brand.name} (${brand.niche}), market: ${brand.market}
Voice: ${brand.voice ?? "plain, concrete, no hype"}
${styleBlock(brief.language, brief.styleGuide)}

Topic: ${brief.topic}
Title (fixed — it is titleOptions[0]): ${brief.title}
Target length: ${brief.targetMinutes} minutes, about ${words} spoken words in total across hook, sections and call to action.${
    brief.lessons.length
      ? `\n\nLESSONS Anton saved — use the hooks as patterns and the facts as leads to verify (a saved fact still needs a source URL):\n${lessonLines(brief.lessons)}`
      : ""
  }${factsBlock(brief.facts)}${referenceBlock(brief.references)}

Write the script: a hook that earns the next 30 seconds, sections in a clear order, a call to action, three title options (the fixed title first), three thumbnail concepts, b-roll shots and sources.`;

  const { text, costUsd, groundingQueries, finishReason } = await structuredJson({
    system,
    prompt: userPrompt,
    schema: SCRIPT_JSON_SCHEMA,
    webSearch: true,
    estimateUsd: estimateScriptCostUsd(),
    maxOutputTokens: SCRIPT_MAX_OUTPUT_TOKENS,
  });

  let raw: RawScript;
  try {
    raw = JSON.parse(text) as RawScript;
  } catch {
    throw new ScriptGenerationError(
      `Gemini didn't return a parseable script (finish reason: ${finishReason ?? "unknown"}). Try again.`,
    );
  }

  let body: ScriptBodyV1;
  try {
    body = assembleScriptBody(raw, brief);
  } catch (err) {
    throw new ScriptGenerationError(
      `Gemini's script was missing whole parts (${err instanceof Error ? err.message : String(err)}). Try again.`,
    );
  }
  const verdict = validateScriptBody(body);
  if (!verdict.ok) {
    throw new ScriptGenerationError(
      "Gemini's script does not match the script contract. Try again.",
      verdict.errors,
    );
  }
  return { body, costUsd, groundingQueries };
}

// ---------------------------------------------------------------------------
// posts — drafting for engagement, adapting across a family (PLAN.md §1.46–§1.47, §5.O11)
// ---------------------------------------------------------------------------

/** A post is a caption plus up to 20 slides or a handful of shots — far short of a script. */
const POST_MAX_OUTPUT_TOKENS = 8_000;
const POST_THINKING_TOKENS = 4_000;
/** Playbook + style guide + kit + facts + lessons (+ the source draft when adapting). */
const POST_PROMPT_OVERHEAD_TOKENS = 10_000;
/** A post from a bare topic researches it; from an idea or when adapting it does not. */
const POST_MAX_GROUNDING_QUERIES = 5;

export function estimatePostCostUsd(grounded: boolean, model: string = MODEL): number {
  const tokens = costUsdAtRates(ideationRates(model), {
    inputTokens: POST_PROMPT_OVERHEAD_TOKENS,
    outputTokens: POST_MAX_OUTPUT_TOKENS + POST_THINKING_TOKENS,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  });
  return tokens + (grounded ? POST_MAX_GROUNDING_QUERIES * GROUNDING_USD_PER_QUERY : 0);
}

/**
 * What the model fills in for a post (`RawPostDraft`). All three lists are
 * optional here because a schema cannot tie them to the format; the prompt
 * names the one to write and `assemblePostDraft` keeps only that one.
 */
export const POST_DRAFT_JSON_SCHEMA = {
  type: "object",
  properties: {
    hook: {
      type: "string",
      description: "The first line / first second: what stops the scroll. Under 12 words.",
    },
    caption: {
      type: "string",
      description:
        "The full caption as it is posted, in the target language: hook line, body, the call to action. No hashtags in it.",
    },
    cta: { type: "string", description: "The one action asked for, as it reads in the caption." },
    hashtags: {
      type: "array",
      maxItems: MAX_HASHTAGS,
      items: { type: "string", description: "One tag, without #." },
    },
    firstComment: {
      type: "string",
      description: "Optional first comment (links, sources, keyword).",
    },
    altText: {
      type: "string",
      description: "Alt text for the first image, in the target language.",
    },
    engagement: {
      type: "object",
      properties: {
        mechanic: { type: "string", enum: [...ENGAGEMENT_MECHANICS] },
        detail: {
          type: "string",
          description: "What exactly is asked: the question, the keyword, the poll options.",
        },
      },
      required: ["mechanic", "detail"],
    },
    slides: {
      type: "array",
      maxItems: CAROUSEL_SLIDES.max,
      items: {
        type: "object",
        properties: {
          headline: { type: "string" },
          body: { type: "string" },
          visualPrompt: {
            type: "string",
            description:
              "Image prompt in English, photographic or illustrated, no text in the image.",
          },
          textOverlay: {
            type: "string",
            description: "The words set on the slide, target language.",
          },
        },
        required: ["headline", "visualPrompt"],
      },
    },
    shots: {
      type: "array",
      maxItems: 20,
      items: {
        type: "object",
        properties: {
          seconds: { type: "number", minimum: 1, maximum: 60 },
          onScreenText: { type: "string" },
          voiceover: { type: "string" },
          imagePrompt: { type: "string", description: "Vertical 9:16 still, English." },
          videoPrompt: { type: "string", description: "Camera motion for the still, English." },
        },
        required: ["seconds", "imagePrompt", "videoPrompt"],
      },
    },
    storyFrames: {
      type: "array",
      maxItems: 10,
      items: {
        type: "object",
        properties: {
          text: { type: "string" },
          sticker: { type: "string", enum: [...STORY_STICKERS] },
          visualPrompt: { type: "string", description: "Vertical 9:16 background, English." },
        },
        required: ["visualPrompt"],
      },
    },
    sources: {
      type: "array",
      items: {
        type: "object",
        properties: {
          claim: { type: "string" },
          url: { type: "string", description: "Full URL of a page that states the claim." },
        },
        required: ["claim", "url"],
      },
    },
    notes: { type: "string", description: "Anything the owner must check before posting." },
  },
  required: ["hook", "caption", "cta", "hashtags", "engagement", "sources"],
} as const;

/** A fact handed to a post prompt. Unverified facts may only be said in their hedged wording (§1.48). */
export type PromptPostFact = PromptFact & { verified: boolean };

/** The brand kit fields a post prompt uses. */
export type PromptKit = {
  ctas: string[];
  hashtags: string[];
  dos: string | null;
  donts: string | null;
  styleNotes: string;
};

/** Where a post is going: one account, its brand, and the house rules for it. */
export type PostTarget = {
  brand: Brand;
  platform: string;
  handle: string;
  /** The account's effective language tag. */
  language: string;
  format: PostFormat;
  kit: PromptKit | null;
  facts: PromptPostFact[];
  lessons: PromptLesson[];
  /** `content/playbooks/<platform>.md`, whole. */
  playbook: string;
  /** `content/style/<language>.md`, whole. */
  styleGuide: string;
  /** This account's best posts of the last 90 days (§1.51, O12); empty without insights. */
  whatWorked?: PromptWhatWorked[];
};

/** One of an account's top posts by (saves + shares + comments) / reach (§1.51). */
export type PromptWhatWorked = {
  format: string;
  hook: string;
  caption: string;
  reach: number;
  saves: number;
  shares: number;
  comments: number;
  /** (saves + shares + comments) / reach. */
  rate: number;
};

function whatWorkedBlock(rows: PromptWhatWorked[] | undefined): string {
  if (!rows?.length) return "";
  const lines = rows
    .map(
      (r) =>
        `- ${r.format}, ${(r.rate * 100).toFixed(1)}% engagement on ${r.reach} reached (${r.saves} saves, ${r.shares} shares, ${r.comments} comments). Hook: "${r.hook}". Caption start: "${r.caption}"`,
    )
    .join("\n");
  return `\n\nWHAT WORKED on this account in the last 90 days (measured, best first) — learn from the PATTERNS (topic, hook shape, mechanic), never copy them word for word:\n${lines}`;
}

/** What a post is drafted from: an idea on file, or a bare topic. */
export type PostSeed =
  | {
      idea: {
        title: string;
        angle: string;
        draftCopy: string;
        visualNotes?: string | null;
        citations?: { claim: string; sources: string[] }[] | null;
      };
    }
  | { topic: string };

export class PostGenerationError extends Error {
  constructor(
    message: string,
    readonly errors: string[] = [],
  ) {
    super(message);
    this.name = "PostGenerationError";
  }
}

const FORMAT_PARTS: Record<PostFormat, string> = {
  carousel: `Write "slides": ${CAROUSEL_SLIDES.min}–10 slides (7–10 is the sweet spot) following the playbook's carousel arc. Leave "shots" and "storyFrames" empty.`,
  image_post: `Write "slides" with exactly ONE slide: the image and its overlay. Leave "shots" and "storyFrames" empty.`,
  reel: `Write "shots": 4–10 vertical shots, 15–45 seconds in total, the hook in the first shot. Leave "slides" and "storyFrames" empty.`,
  video: `Write "shots": the video's shots in order. Leave "slides" and "storyFrames" empty.`,
  story: `Write "storyFrames": 3–7 frames with the playbook's sticker sequence. Leave "slides" and "shots" empty.`,
  text: `A text-only post: leave "slides", "shots" and "storyFrames" empty.`,
};

function postFactsBlock(facts: PromptPostFact[]): string {
  if (!facts.length) return "";
  const lines = facts.map(
    (f) =>
      `- [${f.topic}]${f.verified ? "" : " [UNVERIFIED — say it only in this hedged wording]"} ${f.claim}${
        f.sourceUrl ? ` (source: ${f.sourceUrl})` : " (no source URL on file)"
      }`,
  );
  return `\n\nFACTS — the checked fact sheet for this brand and its family. Use these as-is (do not change numbers, dates or names) and put their URL in "sources" when you use one. A fact marked UNVERIFIED may only be said in its hedged wording, never as certain. A claim not listed here needs its own source URL, or it is left out:\n${lines.join("\n")}`;
}

function kitBlock(kit: PromptKit | null): string {
  if (!kit) return "";
  const parts = [
    kit.ctas.length ? `CTAs the brand uses: ${kit.ctas.join(" | ")}` : "",
    kit.hashtags.length
      ? `Brand hashtags (include the relevant ones): ${kit.hashtags.join(" ")}`
      : "",
    kit.dos?.trim() ? `Do: ${kit.dos.trim()}` : "",
    kit.donts?.trim() ? `Don't: ${kit.donts.trim()}` : "",
    kit.styleNotes.trim() ? `Visual style for image prompts: ${kit.styleNotes.trim()}` : "",
  ].filter(Boolean);
  return parts.length ? `\n\nBRAND KIT:\n${parts.join("\n")}` : "";
}

function targetBlock(t: PostTarget): string {
  return `Brand: ${t.brand.name} (${t.brand.niche}), market: ${t.brand.market}
Voice: ${t.brand.voice ?? "plain, concrete, no hype"}
Account: @${t.handle} on ${t.platform}
Language: ${languageName(t.language)} (tag ${t.language}). Every word the audience reads or hears is in this language; image and video prompts stay in English.
Format: ${t.format}. ${FORMAT_PARTS[t.format]}${
    t.styleGuide.trim() ? `\n\nSTYLE GUIDE — follow it:\n${t.styleGuide.trim()}` : ""
  }${t.playbook.trim() ? `\n\nPLAYBOOK — the engagement patterns for ${t.platform}; follow it:\n${t.playbook.trim()}` : ""}${kitBlock(
    t.kit,
  )}${
    t.lessons.length
      ? `\n\nLESSONS the owner saved (hooks, CTAs, caption patterns that worked) — use the PATTERNS, never copy them word for word:\n${lessonLines(t.lessons)}`
      : ""
  }${whatWorkedBlock(t.whatWorked)}${postFactsBlock(t.facts)}`;
}

const POST_SYSTEM = `You write social media posts that earn engagement — saves, shares, comments — for small businesses. You follow the platform playbook and the style guide you are given. One post has one hook, one engagement mechanic and one call to action.

Facts: never invent a law, price, fee, deadline, statistic or program name. Every factual claim goes in "sources" with the full URL of a page that states it; if you have no source for a claim, leave the claim out. Facts marked UNVERIFIED are said only in their hedged wording.

Image and video prompts are in English, specific and visual, with no text in the image and no real people's likenesses. Answer with JSON matching the required schema and nothing else.`;

function parsePostAnswer(
  text: string,
  finishReason: string | undefined,
  target: { format: PostFormat; language: string },
): PostDraft {
  let raw: RawPostDraft;
  try {
    raw = JSON.parse(text) as RawPostDraft;
  } catch {
    throw new PostGenerationError(
      `The model didn't return a parseable post (finish reason: ${finishReason ?? "unknown"}). Try again.`,
    );
  }
  const draft = assemblePostDraft(raw, target);
  const verdict = validatePostDraft(draft);
  if (!verdict.ok) {
    throw new PostGenerationError(
      "The model's post does not match the post contract. Try again.",
      verdict.errors,
    );
  }
  return draft;
}

/**
 * Draft one post for one account (§1.46, §5.O11.1). From an idea it builds on
 * the idea's copy and citations, ungrounded; from a bare topic it researches
 * with Search, so every claim can carry a URL. With `rewrite`, the model sees
 * the current draft and rewrites only that section (the caller merges it).
 * Returns a body the contract accepts, or throws `PostGenerationError` —
 * after billing, since the tokens were spent either way.
 */
export async function draftPost(
  seed: PostSeed,
  target: PostTarget,
  rewrite?: { current: PostDraft; section: string },
): Promise<{ body: PostDraft; costUsd: number; groundingQueries: number }> {
  const grounded = "topic" in seed && !rewrite;
  const seedBlock =
    "topic" in seed
      ? `TOPIC: ${seed.topic}${grounded ? `\nResearch it with Google Search first (at most ${POST_MAX_GROUNDING_QUERIES} searches — each one costs money).` : ""}`
      : `IDEA on file — build the post on it, in the target language and format:
Title: ${seed.idea.title}
Angle: ${seed.idea.angle}
Draft copy: ${seed.idea.draftCopy}${seed.idea.visualNotes ? `\nVisual notes: ${seed.idea.visualNotes}` : ""}${
          seed.idea.citations?.length
            ? `\nCitations already checked:\n${seed.idea.citations
                .map((c) => `- ${c.claim} (${c.sources.join(", ")})`)
                .join("\n")}`
            : ""
        }`;
  const rewriteBlock = rewrite
    ? `\n\nCURRENT DRAFT (JSON):\n${JSON.stringify(rewrite.current)}\n\nRewrite ONLY "${rewrite.section}" — make it clearly better and different. Return the whole post, with every other field as it is now.`
    : "\n\nWrite the post.";

  const { text, costUsd, groundingQueries, finishReason } = await structuredJson({
    system: POST_SYSTEM,
    prompt: `${targetBlock(target)}\n\n${seedBlock}${rewriteBlock}`,
    schema: POST_DRAFT_JSON_SCHEMA,
    webSearch: grounded,
    estimateUsd: estimatePostCostUsd(grounded),
    maxOutputTokens: POST_MAX_OUTPUT_TOKENS,
    thinkingLow: !grounded,
  });
  const body = parsePostAnswer(text, finishReason, target);
  return { body, costUsd, groundingQueries };
}

/**
 * Adapt a post to a sibling account (§1.47): not a translation — a rewrite
 * for that brand's language, voice and audience. Ungrounded. The target's
 * facts are the only facts it may state; a claim of the source post that the
 * target's facts (or the source's own cited URL) do not support is dropped.
 */
export async function adaptPost(
  source: PostDraft,
  target: PostTarget,
): Promise<{ body: PostDraft; costUsd: number }> {
  const prompt = `${targetBlock(target)}

SOURCE POST (JSON), written for a sibling brand in ${languageName(source.language)}:
${JSON.stringify(source)}

Adapt it for THIS account: same topic and the same engagement mechanic, rewritten from scratch for this brand's audience, voice and language — not translated line by line. Keep the structure (number of slides or shots) unless the playbook says otherwise. Keep a claim only if the FACTS above or the source post's own cited URL support it, and cite it; a fact that differs for this audience (a price in another currency, a rule for another nationality) is left out rather than guessed. Hashtags are the ones this audience searches for, in this language.`;

  const { text, costUsd, finishReason } = await structuredJson({
    system: POST_SYSTEM,
    prompt,
    schema: POST_DRAFT_JSON_SCHEMA,
    webSearch: false,
    estimateUsd: estimatePostCostUsd(false),
    maxOutputTokens: POST_MAX_OUTPUT_TOKENS,
    thinkingLow: true,
  });
  const body = parsePostAnswer(text, finishReason, target);
  return { body, costUsd };
}

// ---------------------------------------------------------------------------
// clip transcription (PLAN.md §1.44) — Gemini only, because it needs the media
// ---------------------------------------------------------------------------

/** The cheap multimodal seat: listening and reading, no judgement. */
const TRANSCRIBE_MODEL = process.env.GEMINI_TRANSCRIBE_MODEL ?? "gemini-3.1-flash-lite";
/** Past this, a reel is a long video; research clips are short. */
export const TRANSCRIBE_MAX_SECONDS = 15 * 60;
/** Assumed when the duration is unknown: IG reels and TikToks run up to three minutes. */
const TRANSCRIBE_ASSUMED_SECONDS = 180;
/** Gemini's inline request limit is 20 MB, base64 included; stay under it. */
export const TRANSCRIBE_MAX_INLINE_BYTES = 14 * 1024 * 1024;
const TRANSCRIBE_MAX_OUTPUT_TOKENS = 6_000;
const TRANSCRIBE_PROMPT_OVERHEAD_TOKENS = 800;
/** Default media resolution: ~260 tokens per frame at 1 fps + 32 for audio, rounded up. */
const MEDIA_TOKENS_PER_SECOND = 300;
/** A photo (a clip sent as an image) is one frame. */
const IMAGE_TOKENS = 1_300;

export const TRANSCRIPT_JSON_SCHEMA = {
  type: "object",
  properties: {
    transcript: {
      type: "string",
      description:
        "Everything said, verbatim, in the language it is spoken. Empty if nothing is said.",
    },
    postText: {
      type: "string",
      description: "The text shown on screen, in order, verbatim. Empty if none.",
    },
    summary: {
      type: "string",
      description: "What the clip says and shows, 2-4 sentences, English.",
    },
    claims: {
      type: "array",
      items: {
        type: "object",
        properties: {
          claim: {
            type: "string",
            description: "One factual claim made (a rule, price, number, deadline), as stated.",
          },
          timestampSec: { type: "number", minimum: 0 },
        },
        required: ["claim"],
      },
    },
  },
  required: ["transcript", "postText", "summary", "claims"],
} as const;

export type ClipTranscript = {
  transcript: string;
  postText: string;
  summary: string;
  claims: { claim: string; timestampSec?: number }[];
};

export type TranscribeInput = {
  /** The media file on disk (absolute). S17 passes `MEDIA_ROOT` + the asset's `local_path`. */
  path?: string;
  /** A YouTube URL or a Gemini Files URI, when there is no local file. */
  url?: string;
  mime?: string | null;
  durationSec?: number | null;
  /** The caption or note the clip was saved with, to help read the screen text. */
  context?: string | null;
};

export class TranscribeRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TranscribeRefusedError";
  }
}

export function estimateTranscribeCostUsd(
  input: { durationSec?: number | null; mime?: string | null },
  model: string = TRANSCRIBE_MODEL,
): number {
  const image = input.mime?.startsWith("image/");
  const seconds =
    input.durationSec && input.durationSec > 0 ? input.durationSec : TRANSCRIBE_ASSUMED_SECONDS;
  return costUsdAtRates(ideationRates(model), {
    inputTokens:
      (image ? IMAGE_TOKENS : Math.ceil(seconds * MEDIA_TOKENS_PER_SECOND)) +
      TRANSCRIBE_PROMPT_OVERHEAD_TOKENS,
    outputTokens: TRANSCRIBE_MAX_OUTPUT_TOKENS,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  });
}

/**
 * Transcribe a fetched clip (§1.44): the words said, the text on screen, a
 * summary and the claims made — one Flash-Lite call under the spend cap.
 * Always Gemini, whatever `AI_PROVIDER` says: the CLI providers cannot take
 * the media. Research only; nothing here republishes anyone's media.
 * Refuses (for free) a clip past `TRANSCRIBE_MAX_SECONDS` or a file too big to
 * send inline.
 */
export async function transcribeClip(
  input: TranscribeInput,
): Promise<ClipTranscript & { costUsd: number }> {
  if (!input.path && !input.url)
    throw new TranscribeRefusedError("Nothing to transcribe: no file and no URL.");
  if (input.durationSec && input.durationSec > TRANSCRIBE_MAX_SECONDS) {
    throw new TranscribeRefusedError(
      `This clip is ${Math.round(input.durationSec / 60)} minutes long; transcription stops at ${TRANSCRIBE_MAX_SECONDS / 60} minutes.`,
    );
  }

  let media:
    | { inlineData: { mimeType: string; data: string } }
    | { fileData: { fileUri: string; mimeType?: string } };
  if (input.path) {
    const { readFile, stat } = await import("node:fs/promises");
    const size = (await stat(input.path)).size;
    if (size > TRANSCRIBE_MAX_INLINE_BYTES) {
      throw new TranscribeRefusedError(
        `This file is ${Math.round(size / 1024 / 1024)} MB; transcription sends files up to ${TRANSCRIBE_MAX_INLINE_BYTES / 1024 / 1024} MB.`,
      );
    }
    media = {
      inlineData: {
        mimeType: input.mime ?? "video/mp4",
        data: (await readFile(input.path)).toString("base64"),
      },
    };
  } else {
    media = { fileData: { fileUri: input.url!, ...(input.mime ? { mimeType: input.mime } : {}) } };
  }

  const prompt = `This is a short social media clip saved for research and fact-checking.${
    input.context?.trim() ? `\nIt was saved with this note or caption: ${input.context.trim()}` : ""
  }
Transcribe what is said, copy the on-screen text, summarise it, and list every factual claim it makes (rules, prices, numbers, deadlines, program names) with the second it is made.`;

  return withSpendCap(estimateTranscribeCostUsd(input), async () => {
    const response = await dispatchSpend(() =>
      geminiClient().models.generateContent({
        model: TRANSCRIBE_MODEL,
        contents: [{ role: "user", parts: [media, { text: prompt }] }],
        config: {
          systemInstruction:
            "You transcribe and summarise social media clips accurately. Never add claims that are not in the clip. Answer with JSON matching the required schema and nothing else.",
          maxOutputTokens: TRANSCRIBE_MAX_OUTPUT_TOKENS,
          thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
          responseMimeType: "application/json",
          responseJsonSchema: TRANSCRIPT_JSON_SCHEMA,
        },
      }),
    );
    // Billed whether or not the answer parses: the tokens were spent.
    const costUsd = messageCostUsd(readUsage(response), 0, TRANSCRIBE_MODEL);
    await recordSpend(costUsd);

    let parsed: Partial<ClipTranscript>;
    try {
      parsed = JSON.parse(responseText(response)) as Partial<ClipTranscript>;
    } catch {
      throw new Error(
        `The model returned no transcript (finish reason: ${
          response.candidates?.[0]?.finishReason ?? "unknown"
        }).`,
      );
    }
    return {
      transcript: String(parsed.transcript ?? "").trim(),
      postText: String(parsed.postText ?? "").trim(),
      summary: String(parsed.summary ?? "").trim(),
      claims: (parsed.claims ?? [])
        .filter((c) => c?.claim?.trim())
        .map((c) => ({
          claim: c.claim.trim(),
          ...(typeof c.timestampSec === "number" && c.timestampSec >= 0
            ? { timestampSec: c.timestampSec }
            : {}),
        })),
      costUsd,
    };
  });
}
