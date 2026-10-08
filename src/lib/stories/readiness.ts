/**
 * Is a scene ready to render in a language? (pure, build 4 §3.C.5–6)
 *
 * Ready = the text passes `canNarrate`, and every narration line has a
 * selected, finished, not-rejected take whose input text is the line's text
 * verbatim. A take made before the text changed does not count.
 */
import { canNarrate, lineSlot, narrationLines, voiceLanguageFor, type NarrateCheck } from "./rules";
import type { SceneAudio, StoryLine } from "./types";

/** The parts of a `narrations` row readiness looks at. */
export type TakeLike = {
  id: number;
  sceneRef: string | null;
  language: string;
  speaker: string | null;
  selected: boolean;
  status: string;
  inputText: string;
  reviewStatus: string;
  durationMs: number | null;
  createdAt?: Date | string;
};

export type SceneLike = {
  sceneRef: string;
  text: Record<string, string | null>;
  textStatus: Record<string, string>;
  lines?: Record<string, StoryLine[]>;
};

export type LineState<T extends TakeLike = TakeLike> = {
  slot: string;
  line: StoryLine;
  /** The selected take for the slot, if any. */
  selected: T | null;
  /** True when the selected take can be used: done, not rejected, says the current text. */
  usable: boolean;
  /** Why the selected take cannot be used. */
  problem: "none" | "no_take" | "text_changed" | "rejected" | "not_done";
  /** Every take for the slot, newest first. */
  takes: T[];
};

export type SceneReadiness<T extends TakeLike = TakeLike> = {
  text: NarrateCheck;
  lines: LineState<T>[];
  /** Every line has a usable selected take. */
  takesReady: boolean;
  /** Text approved and takes ready. */
  ready: boolean;
};

function newestFirst<T extends TakeLike>(a: T, b: T): number {
  const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
  const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
  return tb - ta || b.id - a.id;
}

export function sceneReadiness<T extends TakeLike>(
  scene: SceneLike,
  lang: string,
  takes: T[],
): SceneReadiness<T> {
  const text = canNarrate(scene, lang);
  const voiceLang = voiceLanguageFor(lang) ?? lang;
  const lines = narrationLines(scene, lang);
  const states = lines.map((line, i): LineState<T> => {
    const slot = lineSlot(scene.sceneRef, i, lines.length);
    const slotTakes = takes
      .filter(
        (t) =>
          t.sceneRef === slot &&
          t.language === voiceLang &&
          (t.speaker ?? null) === (line.speaker ?? null),
      )
      .sort(newestFirst);
    const selected = slotTakes.find((t) => t.selected) ?? null;
    let problem: LineState["problem"] = "none";
    if (!selected) problem = "no_take";
    else if (selected.status !== "done") problem = "not_done";
    else if (selected.reviewStatus === "rejected") problem = "rejected";
    else if (selected.inputText !== line.text) problem = "text_changed";
    return { slot, line, selected, usable: problem === "none", problem, takes: slotTakes };
  });
  const takesReady = states.length > 0 && states.every((s) => s.usable);
  return { text, lines: states, takesReady, ready: text.ok && takesReady };
}

/** Is the built scene audio still the selected takes, in order? */
export function sceneAudioFresh(audio: SceneAudio | undefined, readiness: SceneReadiness): boolean {
  if (!audio || !readiness.takesReady) return false;
  const ids = readiness.lines.map((l) => l.selected?.id);
  return ids.length === audio.takeIds.length && ids.every((id, i) => id === audio.takeIds[i]);
}
