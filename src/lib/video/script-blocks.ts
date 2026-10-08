import path from "node:path";

import type { Narration } from "@/db/schema";
import type { ScriptBodyV1 } from "@/lib/scripts/contract";
import { shotList, type Shot } from "@/lib/scripts/export";

/**
 * The pure half of script → video (PLAN-build4 §3.B.3): which blocks a script
 * has, which take voices each, which file shows under it.
 *
 * The take convention (shared with phase A's voice studio):
 *   narrations.owner_kind = "script"
 *   narrations.owner_ref  = "script:<id>"
 *   narrations.scene_ref  = "hook" | "s01", "s02", … (1-based section index) | "cta"
 * with one row per (scene, language) marked `selected` and `status = done`
 * (the narrator take, `speaker` null, wins over character lines).
 */

export const SCRIPT_HOOK_REF = "hook";
export const SCRIPT_CTA_REF = "cta";

export function sectionSceneRef(index: number): string {
  return `s${String(index + 1).padStart(2, "0")}`;
}

export function scriptOwnerRef(scriptId: number): string {
  return `script:${scriptId}`;
}

export type ScriptBlock = {
  sceneRef: string;
  /** "Hook", the section heading, or "CTA" — for refusals and the plan. */
  label: string;
  spokenText: string;
  onScreenText: string[];
  /** The b-roll shots of this block, from the shot list (same numbering). */
  shots: Shot[];
};

/** The script's spoken blocks in play order; blocks with nothing to say are left out. */
export function scriptBlocks(script: {
  id: number;
  brandId: string;
  status: string;
  body: ScriptBodyV1;
}): ScriptBlock[] {
  const b = script.body;
  const list = shotList(script);
  let cursor = 0;
  const take = (n: number) => {
    const shots = list.shots.slice(cursor, cursor + n);
    cursor += n;
    return shots;
  };
  const blocks: ScriptBlock[] = [
    {
      sceneRef: SCRIPT_HOOK_REF,
      label: "Hook",
      spokenText: b.hook.spokenLines.join(" "),
      onScreenText: b.hook.onScreenText.length ? b.hook.onScreenText : [b.chosenTitle],
      shots: take(b.hook.broll.length),
    },
    ...b.sections.map((s, i) => ({
      sceneRef: sectionSceneRef(i),
      label: s.heading,
      spokenText: s.spokenLines.join(" "),
      onScreenText: s.onScreenText.length ? s.onScreenText : [s.heading],
      shots: take(s.broll.length),
    })),
    {
      sceneRef: SCRIPT_CTA_REF,
      label: "CTA",
      spokenText: b.cta.spokenLines.join(" "),
      onScreenText: b.cta.onScreenText.length ? b.cta.onScreenText : [b.chosenTitle],
      shots: [],
    },
  ];
  return blocks.filter((block) => block.spokenText.trim());
}

/** The selected take per scene ref: done only, narrator first. */
export function pickTakes(rows: Narration[]): Map<string, Narration> {
  const out = new Map<string, Narration>();
  const sorted = [...rows].sort((a, b) => Number(a.speaker !== null) - Number(b.speaker !== null));
  for (const row of sorted) {
    if (!row.sceneRef || !row.selected || row.status !== "done") continue;
    if (!out.has(row.sceneRef)) out.set(row.sceneRef, row);
  }
  return out;
}

const VIDEO_EXT = /\.(mp4|mov|webm)$/i;
const IMAGE_EXT = /\.(png|jpe?g|webp)$/i;

/**
 * The visual for a block: the first of its shots with a file in the script's
 * media folder (`dir`, whose file names are `files`) — the shot's video, else
 * its still. Matched by the shot's `NN-` number, so a description edited after
 * the shots were made still finds them. Null when there is none.
 */
export function pickVisual(
  dir: string,
  shots: Shot[],
  files: string[],
): { file: string; kind: "image" | "video" } | null {
  for (const shot of shots) {
    const prefix = `${String(shot.number).padStart(2, "0")}-`;
    const mine = files.filter((f) => f.startsWith(prefix));
    const video = mine.find((f) => VIDEO_EXT.test(f));
    if (video) return { file: path.join(dir, video), kind: "video" };
    const image = mine.find((f) => IMAGE_EXT.test(f));
    if (image) return { file: path.join(dir, image), kind: "image" };
  }
  return null;
}
