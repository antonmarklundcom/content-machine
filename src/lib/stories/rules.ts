/**
 * Language rules for story narration (docs/PLAN-build4.md §1.2–§1.4). Pure.
 *
 * - A scene is narrated in a language only when its text for that language is
 *   there and its status is approved; unknown or pending refuses.
 * - Text carrying a pending-review notice always refuses — the notice must
 *   never be read aloud.
 * - A missing language is a refusal, never a fallback to another language.
 * - Guaraní is recorded by people (upload only); no TTS for `gn`.
 */
import type { VoiceLanguage } from "@/lib/voice/contract";
import type { StoryLine } from "./types";

/** Statuses that allow narration. `approved-in-app` is the owner's click in /stories. */
export const APPROVED_STATUSES = [
  "approved",
  "final",
  "reviewed",
  "locked",
  "approved-in-app",
] as const;
export const IN_APP_APPROVED = "approved-in-app";

/** `"Approved"`, `"approved_in_app"`, `" final "` → the canonical spelling. */
export function normalizeStatus(status: string | null | undefined): string | null {
  if (typeof status !== "string") return null;
  const s = status
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-");
  return s || null;
}

export function isApprovedStatus(status: string | null | undefined): boolean {
  const s = normalizeStatus(status);
  return s !== null && (APPROVED_STATUSES as readonly string[]).includes(s);
}

/**
 * Pending-review notices. Case matters for the Spanish words: `todo`,
 * `pendiente` and `revisar` are ordinary words in a story ("todo el día",
 * "la pendiente"); the notices are written in capitals.
 */
const PENDING_PATTERNS: RegExp[] = [
  /PENDIENTE/,
  /REVISAR/,
  /\bTODO\b/,
  /\[\?\?\]/,
  /pending[\s_-]*review/i,
  /\bTBD\b/,
  /\[\s*(?:gn|guaran[ií])\s*\??\s*\]/i,
];

/** The first pending-review notice in `text`, or null. */
export function findPendingNotice(text: string | null | undefined): string | null {
  if (!text) return null;
  for (const re of PENDING_PATTERNS) {
    const m = re.exec(text);
    if (m) return m[0];
  }
  return null;
}

export type NarrateCheck =
  | { ok: true; text: string; status: string }
  | {
      ok: false;
      reason: "missing_text" | "status_unknown" | "not_approved" | "pending_notice";
      message: string;
    };

type SceneLike = {
  sceneRef: string;
  text: Record<string, string | null>;
  textStatus: Record<string, string>;
  lines?: Record<string, StoryLine[]>;
};

/** May `scene` be narrated in story language `lang`? (§1.3) */
export function canNarrate(scene: SceneLike, lang: string): NarrateCheck {
  const text = scene.text[lang];
  if (typeof text !== "string" || text.trim() === "") {
    return {
      ok: false,
      reason: "missing_text",
      message: `${scene.sceneRef} has no ${lang} text. It is never filled from another language.`,
    };
  }
  const notice =
    findPendingNotice(text) ??
    (scene.lines?.[lang] ?? []).map((l) => findPendingNotice(l.text)).find(Boolean) ??
    null;
  if (notice) {
    return {
      ok: false,
      reason: "pending_notice",
      message: `${scene.sceneRef} ${lang} text carries a pending-review notice ("${notice}").`,
    };
  }
  const status = normalizeStatus(scene.textStatus[lang]);
  if (!status) {
    return {
      ok: false,
      reason: "status_unknown",
      message: `${scene.sceneRef} ${lang} text has no review status.`,
    };
  }
  if (!isApprovedStatus(status)) {
    return {
      ok: false,
      reason: "not_approved",
      message: `${scene.sceneRef} ${lang} text is "${status}", not approved.`,
    };
  }
  return { ok: true, text, status };
}

/**
 * Whether the owner may mark the text approved here: the text must exist and
 * carry no pending notice. (Approving here is how a reviewed text that the
 * repo has not caught up with yet becomes narratable.)
 */
export function canApproveInApp(scene: SceneLike, lang: string): NarrateCheck {
  const check = canNarrate(scene, lang);
  if (check.ok) return check;
  if (check.reason === "status_unknown" || check.reason === "not_approved") {
    return { ok: true, text: scene.text[lang] as string, status: IN_APP_APPROVED };
  }
  return check;
}

/** Story text language → voice-engine language. `es` is castellano paraguayo. */
export function voiceLanguageFor(lang: string): VoiceLanguage | null {
  const map: Record<string, VoiceLanguage> = {
    es: "es-PY",
    "es-py": "es-PY",
    jopara: "jopara",
    gn: "gn",
    en: "en",
    pt: "pt-BR",
    "pt-br": "pt-BR",
    de: "de",
    nl: "nl",
    sv: "sv",
  };
  return map[lang.toLowerCase()] ?? null;
}

/** Guaraní is recorded by a person and uploaded; no TTS takes (§1.4). */
export function ttsAllowed(lang: string): boolean {
  return voiceLanguageFor(lang) !== "gn";
}

/**
 * The narration slot of one line: the scene id when the scene is one line,
 * `S03#2` for the second of several. The voice engine selects one take per
 * (owner, scene, language, speaker), so lines that share a speaker need their
 * own slot.
 */
export function lineSlot(sceneRef: string, index: number, count: number): string {
  return count <= 1 ? sceneRef : `${sceneRef}#${index + 1}`;
}

/** The lines to narrate: the audio script's split when there is one, else the text as one narrator line. */
export function narrationLines(scene: SceneLike, lang: string): StoryLine[] {
  const lines = scene.lines?.[lang];
  if (lines && lines.length) return lines;
  const text = scene.text[lang];
  return typeof text === "string" && text.trim() ? [{ speaker: null, text }] : [];
}

/** Bedtime pacing: baby and preschool books get a longer pause after each scene. */
export function isBedtimeAge(ageBand: string | null | undefined): boolean {
  if (!ageBand) return false;
  const s = ageBand.toLowerCase();
  if (/(baby|beb[eé]|toddler|pre-?school|pre-?escolar|bedtime|infantil|cuna)/.test(s)) return true;
  const nums = (s.match(/\d+/g) ?? []).map(Number);
  return nums.length > 0 && Math.max(...nums) <= 5;
}

export function scenePadMs(ageBand: string | null | undefined): number {
  return isBedtimeAge(ageBand) ? 900 : 600;
}
