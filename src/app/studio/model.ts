import type { ScriptStatus } from "@/db/schema";
import type { TranslationKey } from "@/lib/i18n";
import type { ScriptBodyV1, ScriptSection } from "@/lib/scripts/contract";

/**
 * The studio's pure helpers (PLAN.md §6.S12): reading a brief's query string,
 * tidying an edited body before it is validated, and turning a body into what
 * the teleprompter shows. No I/O, so the unit tests cover them without a page.
 */

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * `/studio/new?brand=<id>&ref=<videoId>&ref=…` — S10's "Use as reference"
 * link. A ref is a `videos.id`; anything else is ignored rather than refused,
 * because a stale link should still open the form.
 */
export function parseBriefParams(params: SearchParams): { brand: string | null; refs: number[] } {
  const brand =
    typeof params.brand === "string" && params.brand.trim() ? params.brand.trim() : null;
  const raw = params.ref === undefined ? [] : Array.isArray(params.ref) ? params.ref : [params.ref];
  const refs: number[] = [];
  for (const value of raw.flatMap((r) => r.split(","))) {
    const id = Number(value.trim());
    if (Number.isInteger(id) && id > 0 && !refs.includes(id)) refs.push(id);
  }
  return { brand, refs };
}

function lines(values: string[]): string[] {
  return values.map((l) => l.trim()).filter(Boolean);
}

/**
 * What the editor's text areas hold is one line per row, blank rows included
 * while someone types. Before a save the blanks go, lines are trimmed, and an
 * empty video prompt becomes `null` (a still, in the contract's words). Returns
 * a copy; the editor's state is untouched.
 */
export function normalizeBody(body: ScriptBodyV1): ScriptBodyV1 {
  const b = structuredClone(body);
  const shots = (list: ScriptBodyV1["hook"]["broll"]) =>
    list.map((s) => ({ ...s, videoPrompt: s.videoPrompt?.trim() ? s.videoPrompt : null }));
  b.hook = {
    spokenLines: lines(b.hook.spokenLines),
    onScreenText: lines(b.hook.onScreenText),
    broll: shots(b.hook.broll),
  };
  b.sections = b.sections.map((s) => ({
    ...s,
    spokenLines: lines(s.spokenLines),
    talkingPoints: lines(s.talkingPoints),
    onScreenText: lines(s.onScreenText),
    broll: shots(s.broll),
  }));
  b.cta = { spokenLines: lines(b.cta.spokenLines), onScreenText: lines(b.cta.onScreenText) };
  return b;
}

/** Ids of the sources marked "verify before recording". */
export function flaggedSourceIds(body: Pick<ScriptBodyV1, "sources">): Set<string> {
  return new Set(body.sources.filter((s) => s.verifyBeforeRecording).map((s) => s.id));
}

/** The flagged sources a section leans on — non-empty means it gets the badge. */
export function sectionVerifyIds(
  section: Pick<ScriptSection, "sourceIds">,
  flagged: Set<string>,
): string[] {
  return section.sourceIds.filter((id) => flagged.has(id));
}

export type TeleprompterBlock = {
  kind: "hook" | "section" | "cta";
  /** The section heading; null for the hook and the CTA (the UI labels those). */
  heading: string | null;
  lines: string[];
  /** Flagged source ids this block relies on. */
  verify: string[];
};

/**
 * Spoken lines only, in reading order. Talking points, on-screen text and
 * shots never reach the teleprompter, so nothing is read aloud by mistake.
 */
export function teleprompterBlocks(body: ScriptBodyV1): TeleprompterBlock[] {
  const flagged = flaggedSourceIds(body);
  return [
    { kind: "hook" as const, heading: null, lines: lines(body.hook.spokenLines), verify: [] },
    ...body.sections.map((s) => ({
      kind: "section" as const,
      heading: s.heading,
      lines: lines(s.spokenLines),
      verify: sectionVerifyIds(s, flagged),
    })),
    { kind: "cta" as const, heading: null, lines: lines(body.cta.spokenLines), verify: [] },
  ].filter((b) => b.lines.length > 0);
}

/** The validator's errors that belong to one part of the body, e.g. `body.sections[2]`. */
export function errorsUnder(errors: string[], prefix: string): string[] {
  return errors.filter((e) => e.startsWith(prefix) && /^[\s.[]/.test(e.slice(prefix.length)));
}

export const STATUS_LABEL: Record<ScriptStatus, TranslationKey> = {
  draft: "studio.status.draft",
  ready: "studio.status.ready",
  recorded: "studio.status.recorded",
  posted: "studio.status.posted",
};

/** `SCRIPT_STATUSES` in order, without pulling the drizzle schema into a client bundle. */
export const STUDIO_STATUSES = Object.keys(STATUS_LABEL) as ScriptStatus[];
