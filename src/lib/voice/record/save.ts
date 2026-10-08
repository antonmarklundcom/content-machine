/**
 * Keep one recorded line (build 5 §3.B): the line is rebuilt on the server
 * from the source (never trusted from the browser), refused when locked or
 * when its text changed since the page loaded, and saved with
 * `importRecording` under the slot conventions of the stories studio
 * (`story_scene`, `story:<slug>`, `S03` / `S03#2`) or the video studio
 * (`script`, `script:<id>`, `hook` / `s01` / `cta`) — so the take shows up
 * there, and in the dataset export as an approved manual take later.
 */
import "server-only";

import { selectSceneTake } from "@/lib/stories/studio";
import { importRecording, selectTake, type NarrateResult } from "@/lib/voice";

import type { RecordSource } from "./lines";
import { resolveSource, sourceTakes } from "./session";

export class RecordError extends Error {
  constructor(
    readonly reason: "not_found" | "locked" | "text_changed" | "no_profile",
    message: string,
  ) {
    super(message);
    this.name = "RecordError";
  }
}

export type SaveLineInput = {
  source: RecordSource;
  slot: string;
  voiceProfileId: number | null;
  filePath: string;
  /** The text the narrator saw; a mismatch with the current text refuses. */
  expectedText?: string | null;
  /** Select the take when the slot has no selected take of the current text yet. */
  autoSelect?: boolean;
};

export type SaveLineResult = {
  narrationId: number;
  durationMs: number;
  selected: boolean;
  notes: string[];
};

export type SaveDeps = {
  importRecording: typeof importRecording;
  selectTake: typeof selectTake;
  selectSceneTake: typeof selectSceneTake;
};

export async function saveRecordedLine(
  input: SaveLineInput,
  deps: Partial<SaveDeps> = {},
): Promise<SaveLineResult> {
  const d: SaveDeps = { importRecording, selectTake, selectSceneTake, ...deps };
  if (!input.voiceProfileId) {
    throw new RecordError("no_profile", "Pick the speaker's voice profile before recording.");
  }
  const resolved = await resolveSource(input.source);
  if (!resolved) throw new RecordError("not_found", "That story or script is not there any more.");
  const line = resolved.lines.find((l) => l.slot === input.slot);
  if (!line) throw new RecordError("not_found", `There is no line ${input.slot} in this source.`);
  if (line.locked) throw new RecordError("locked", line.locked.message);
  // Multipart encoding turns every line break into CRLF, so breaks are compared loosely.
  const lf = (s: string) => s.replace(/\r\n?/g, "\n");
  if (typeof input.expectedText === "string" && lf(input.expectedText) !== lf(line.text)) {
    throw new RecordError(
      "text_changed",
      `The text of ${line.label} changed since the page loaded. Reload and read it again.`,
    );
  }

  const result: NarrateResult = await d.importRecording({
    ownerKind: resolved.ownerKind,
    ownerRef: resolved.ownerRef,
    sceneRef: line.slot,
    language: resolved.voiceLanguage,
    speaker: line.speaker,
    text: line.text,
    voiceProfileId: input.voiceProfileId,
    pronunciationScope: resolved.pronunciationScope,
    filePath: input.filePath,
  });

  const notes: string[] = [];
  let selected = false;
  if (input.autoSelect) {
    const takes = await sourceTakes(resolved);
    const hasSelected = takes.some(
      (t) =>
        t.id !== result.narrationId &&
        t.sceneRef === line.slot &&
        (t.speaker ?? null) === line.speaker &&
        t.selected &&
        t.status === "done" &&
        t.reviewStatus !== "rejected" &&
        t.inputText === line.text,
    );
    if (!hasSelected) {
      if (input.source.kind === "story") {
        const r = await d.selectSceneTake(input.source.slug, result.narrationId);
        notes.push(...r.notes);
      } else {
        await d.selectTake(result.narrationId);
      }
      selected = true;
    }
  }
  return { narrationId: result.narrationId, durationMs: result.durationMs, selected, notes };
}
