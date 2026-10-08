/**
 * In-app scene metadata, kept as JSON in `story_scenes.notes` (pure helpers).
 * The repo's own status stays in `text_status`; what the owner did here
 * (approvals, built scene audio) sits beside it so a re-import can tell the two
 * apart.
 */
import { createHash } from "node:crypto";
import { IN_APP_APPROVED, normalizeStatus } from "./rules";
import type { ParsedScene, SceneMeta } from "./types";

export function readSceneMeta(notes: string | null | undefined): SceneMeta {
  if (!notes) return {};
  try {
    const v = JSON.parse(notes) as unknown;
    return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as SceneMeta) : {};
  } catch {
    return {};
  }
}

export function writeSceneMeta(meta: SceneMeta): string | null {
  const clean: SceneMeta = {};
  if (meta.approvals && Object.keys(meta.approvals).length) clean.approvals = meta.approvals;
  if (meta.audio && Object.keys(meta.audio).length) clean.audio = meta.audio;
  return Object.keys(clean).length ? JSON.stringify(clean) : null;
}

export function textSha(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * The scene's status after a re-import (pure). The repo's status wins, except
 * where the owner approved here and neither the repo's status nor the text has
 * moved since.
 */
export function mergeSceneStatus(
  parsed: Pick<ParsedScene, "sceneRef" | "text" | "textStatus">,
  existingMeta: SceneMeta,
): { textStatus: Record<string, string>; meta: SceneMeta; kept: string[]; dropped: string[] } {
  const textStatus: Record<string, string> = { ...parsed.textStatus };
  const approvals = { ...(existingMeta.approvals ?? {}) };
  const kept: string[] = [];
  const dropped: string[] = [];
  for (const [lang, approval] of Object.entries(approvals)) {
    const text = parsed.text[lang];
    const repoNow = normalizeStatus(parsed.textStatus[lang]);
    const sameStatus = repoNow === normalizeStatus(approval.repoStatus);
    const sameText = typeof text === "string" && textSha(text) === approval.textSha;
    if (sameStatus && sameText) {
      textStatus[lang] = IN_APP_APPROVED;
      kept.push(`${parsed.sceneRef} ${lang}`);
    } else {
      delete approvals[lang];
      const why = !sameText
        ? "text changed"
        : `repo status changed ${approval.repoStatus ?? "(none)"} → ${parsed.textStatus[lang] ?? "(none)"}`;
      dropped.push(`${parsed.sceneRef} ${lang} (${why})`);
    }
  }
  return { textStatus, meta: { ...existingMeta, approvals }, kept, dropped };
}
