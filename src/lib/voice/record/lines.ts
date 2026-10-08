/**
 * What a recording session reads, line by line (build 5 §3.B, docs/RECORDING.md).
 * Pure: the page, the upload route and the tests build the same list, so the
 * text a narrator sees is the text the take is saved with.
 *
 * - Story source: every scene line slot in story order, with the stories
 *   studio's own rules (`canNarrate`, `narrationLines`, `lineSlot`), so a take
 *   lands on the slot `/stories/<slug>` shows. A scene whose text may not be
 *   recorded yet stays in the list, locked, saying why (§1.3: approved text
 *   only — Guaraní included; a missing language is never filled).
 * - Script source: the spoken blocks (`scriptBlocks`: hook, s01…, cta), with the
 *   video studio's take convention. A block carrying a pending-review notice is
 *   locked.
 */
import { canNarrate, lineSlot, narrationLines, voiceLanguageFor } from "@/lib/stories/rules";
import type { StoryLine } from "@/lib/stories/types";
import { scriptOwnerRef, type ScriptBlock } from "@/lib/video/script-blocks";
import { VOICE_LANGUAGES, type NarrationOwnerKind, type VoiceLanguage } from "@/lib/voice/contract";
import { pendingReviewMarker } from "@/lib/voice/refusals";

/** Why a line cannot be recorded yet. `reason` is a stable code; `message` is shown as is. */
export type LineLock = {
  reason:
    "missing_text" | "status_unknown" | "not_approved" | "pending_notice" | "no_voice_language";
  message: string;
};

export type RecordLine = {
  /** Position in the session, 0-based. */
  index: number;
  ownerKind: Extract<NarrationOwnerKind, "story_scene" | "script">;
  ownerRef: string;
  /** The take slot (`narrations.scene_ref`): `S03`, `S03#2`, `hook`, `s01`, `cta`. */
  slot: string;
  /** The scene or block the slot belongs to (`S03`, `hook`). */
  baseRef: string;
  /** Short heading for the teleprompter: `S03 · 2/3`, `Hook`, a section heading. */
  label: string;
  /** Character key of a dialogue line; null = the narrator. */
  speaker: string | null;
  /** The exact text the take is saved with (empty for a locked scene without text). */
  text: string;
  locked: LineLock | null;
};

export type RecordSource =
  { kind: "story"; slug: string; lang: string } | { kind: "script"; scriptId: number };

type StorySceneInput = {
  sceneRef: string;
  text: Record<string, string | null>;
  textStatus: Record<string, string>;
  lines?: Record<string, StoryLine[]>;
};

/** `story:<slug>:<lang>` / `script:<id>` — the source as one URL/form value. */
export function sourceKey(source: RecordSource): string {
  return source.kind === "story"
    ? `story:${source.slug}:${source.lang}`
    : `script:${source.scriptId}`;
}

const SLUG = /^[a-z0-9][a-z0-9._-]{0,200}$/i;
const LANG = /^(?:[a-z]{2,3}(?:-[a-z]{2})?|jopara)$/i;

export function parseSourceKey(value: string | null | undefined): RecordSource | null {
  if (!value) return null;
  const parts = value.trim().split(":");
  if (parts[0] === "story" && parts.length === 3 && SLUG.test(parts[1]) && LANG.test(parts[2])) {
    return { kind: "story", slug: parts[1], lang: parts[2] };
  }
  if (parts[0] === "script" && parts.length === 2 && /^\d{1,9}$/.test(parts[1])) {
    const scriptId = Number(parts[1]);
    return scriptId > 0 ? { kind: "script", scriptId } : null;
  }
  return null;
}

/** The voice-engine language of a story language, or of a script's language. */
export function recordVoiceLanguage(
  source: RecordSource,
  scriptLanguage?: string,
): VoiceLanguage | null {
  if (source.kind === "story") return voiceLanguageFor(source.lang);
  if (!scriptLanguage) return null;
  if ((VOICE_LANGUAGES as readonly string[]).includes(scriptLanguage)) {
    return scriptLanguage as VoiceLanguage;
  }
  return voiceLanguageFor(scriptLanguage);
}

/** Every line slot of a story in one language, locked where the text may not be recorded. */
export function buildStoryLines(
  slug: string,
  scenes: StorySceneInput[],
  lang: string,
): RecordLine[] {
  const ownerRef = `story:${slug}`;
  const voiceLang = voiceLanguageFor(lang);
  const out: RecordLine[] = [];
  for (const scene of scenes) {
    const check = canNarrate(scene, lang);
    const lines = narrationLines(scene, lang);
    let locked: LineLock | null = check.ok
      ? null
      : { reason: check.reason, message: check.message };
    if (!locked && !voiceLang) {
      locked = {
        reason: "no_voice_language",
        message: `There is no voice language for "${lang}".`,
      };
    }
    if (!lines.length) {
      out.push({
        index: out.length,
        ownerKind: "story_scene",
        ownerRef,
        slot: scene.sceneRef,
        baseRef: scene.sceneRef,
        label: scene.sceneRef,
        speaker: null,
        text: "",
        locked: locked ?? {
          reason: "missing_text",
          message: `${scene.sceneRef} has no ${lang} text.`,
        },
      });
      continue;
    }
    lines.forEach((line, i) => {
      out.push({
        index: out.length,
        ownerKind: "story_scene",
        ownerRef,
        slot: lineSlot(scene.sceneRef, i, lines.length),
        baseRef: scene.sceneRef,
        label: lines.length > 1 ? `${scene.sceneRef} · ${i + 1}/${lines.length}` : scene.sceneRef,
        speaker: line.speaker ?? null,
        text: line.text,
        locked,
      });
    });
  }
  return out;
}

/** The spoken blocks of a studio script, locked when a block still carries a pending-review notice. */
export function buildScriptLines(
  scriptId: number,
  blocks: Pick<ScriptBlock, "sceneRef" | "label" | "spokenText">[],
): RecordLine[] {
  const ownerRef = scriptOwnerRef(scriptId);
  return blocks.map((block, index) => {
    const marker = pendingReviewMarker(block.spokenText);
    return {
      index,
      ownerKind: "script",
      ownerRef,
      slot: block.sceneRef,
      baseRef: block.sceneRef,
      label: block.label,
      speaker: null,
      text: block.spokenText,
      locked: marker
        ? {
            reason: "pending_notice",
            message: `${block.label} still carries a pending-review notice ("${marker}").`,
          }
        : null,
    };
  });
}
