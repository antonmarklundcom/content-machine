import { isDefaultLanguage, type OutlinePayload } from "./contract";

/**
 * The outline prompt (PLAN.md §4's five-part structure). Versioned via
 * OUTLINE_PROMPT_VERSION in contract.ts, same convention as the analysis
 * prompt — bump it if a change here alters the meaning of stored output.
 */

export const OUTLINE_SYSTEM_PROMPT = `You write video outlines for a creator who has already analysed a source video and picked one idea worth making. You get the idea and the source video's context; you do not get the source transcript.

Produce a five-part outline for a new video built from this idea:

hook — The first line or beat. It must earn attention on its own, not describe the idea.

rehook — The turn right after the hook that keeps someone who was about to leave. Usually a promise, a stake, or a reversal.

teaching_points — The concrete points the video actually delivers, in the order they land. Each one should be something a viewer could repeat to someone else.

twist — The counter-intuitive turn: where this take differs from the obvious version of the idea.

cta — What the viewer does next, specific to this video's content, not a generic "subscribe."

Be concrete. Write actual lines and beats, not descriptions of what a section should contain.`;

/**
 * Same contract as buildUserPrompt: absent or "en" produces exactly the string
 * this returned before PR-22b.
 */
export function buildOutlineUserPrompt(input: {
  videoTitle: string;
  ideaTitle: string;
  ideaPremise: string;
  ideaWhyNow: string;
  language?: string;
}): string {
  const base = [
    `Source video: ${input.videoTitle}`,
    `Idea: ${input.ideaTitle}`,
    `Premise: ${input.ideaPremise}`,
    `Why now: ${input.ideaWhyNow}`,
  ].join("\n");

  return isDefaultLanguage(input.language)
    ? base
    : `${base}\n\nWrite the outline in ${input.language}.`;
}

export const OUTLINE_JSON_SCHEMA = {
  type: "object",
  properties: {
    hook: { type: "string" },
    rehook: { type: "string" },
    teaching_points: { type: "array", items: { type: "string" } },
    twist: { type: "string" },
    cta: { type: "string" },
  },
  required: ["hook", "rehook", "teaching_points", "twist", "cta"],
  additionalProperties: false,
} as const;

/** Compile-time proof that the schema and the frozen contract agree. */
export type SchemaMatchesContract = OutlinePayload;
