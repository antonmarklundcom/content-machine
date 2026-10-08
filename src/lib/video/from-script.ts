import "server-only";
import { lstat, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { assets, narrations } from "@/db/schema";
import { getBrandKit } from "@/lib/bridge/families";
import { getScript } from "@/lib/bridge/scripts";
import { isScriptBodyV1 } from "@/lib/scripts/contract";
import { renderFolder } from "@/lib/storage/paths";
import { mediaRoot, splitRelative } from "@/lib/storage/root";
import type { VoiceLanguage } from "@/lib/voice/contract";

import type { RenderRequest, RenderScene, VideoFormat } from "./contract";
import { pickTakes, pickVisual, scriptBlocks, scriptOwnerRef } from "./script-blocks";
import { FORMAT_SIZE } from "./timeline";
import { cardColor, renderTitleCard } from "./title-card";

/**
 * Script → video (PLAN-build4 §3.B.3). A studio script becomes one scene per
 * spoken block (hook, each section, CTA), each voiced by its selected take
 * (convention in `./script-blocks`), shown over the block's first b-roll file
 * in `media/<script-id>/`, else over a title card on the brand kit colour.
 */

export * from "./script-blocks";

export class ScriptRenderRefusedError extends Error {
  constructor(
    message: string,
    /** Scene refs with no selected take, when that is the reason. */
    readonly missing: string[] = [],
  ) {
    super(message);
    this.name = "ScriptRenderRefusedError";
  }
}

/** Files directly in `dir`, sorted; empty when it does not exist. */
async function filesIn(dir: string): Promise<string[]> {
  try {
    const names = await readdir(dir);
    const files: string[] = [];
    for (const name of names) {
      const info = await lstat(path.join(dir, name)).catch(() => null);
      if (info?.isFile()) files.push(name);
    }
    return files.sort();
  } catch {
    return [];
  }
}

export type ScriptRenderOptions = {
  scriptId: number;
  language: VoiceLanguage;
  format: VideoFormat;
  burnCaptions?: boolean;
  musicPath?: string | null;
  musicDb?: number;
};

/** The `RenderRequest` for a script, or a `ScriptRenderRefusedError` that says what is missing. */
export async function buildScriptRenderRequest(opts: ScriptRenderOptions): Promise<RenderRequest> {
  const script = await getScript(opts.scriptId);
  if (!script) throw new ScriptRenderRefusedError(`Script ${opts.scriptId} does not exist.`);
  if (!isScriptBodyV1(script.body)) {
    throw new ScriptRenderRefusedError(
      `Script ${opts.scriptId} has a body this renderer cannot read.`,
    );
  }
  const blocks = scriptBlocks({ ...script, body: script.body });
  if (!blocks.length) {
    throw new ScriptRenderRefusedError(`Script ${opts.scriptId} has no spoken lines.`);
  }

  const ownerRef = scriptOwnerRef(script.id);
  const rows = await db
    .select()
    .from(narrations)
    .where(
      and(
        eq(narrations.ownerKind, "script"),
        eq(narrations.ownerRef, ownerRef),
        eq(narrations.language, opts.language),
        eq(narrations.selected, true),
      ),
    );
  const takes = pickTakes(rows);
  const missing = blocks.filter((b) => !takes.has(b.sceneRef));
  if (missing.length) {
    throw new ScriptRenderRefusedError(
      `No selected ${opts.language} take for: ${missing.map((b) => `${b.sceneRef} (${b.label})`).join(", ")}. Record and select a take for each first.`,
      missing.map((b) => b.sceneRef),
    );
  }

  const assetIds = [...takes.values()].flatMap((t) =>
    [t.masterAssetId, t.playbackAssetId].filter((id): id is number => id != null),
  );
  const files = assetIds.length
    ? await db
        .select({ id: assets.id, localPath: assets.localPath })
        .from(assets)
        .where(inArray(assets.id, assetIds))
    : [];
  const pathOf = new Map(files.map((f) => [f.id, f.localPath]));
  const absolute = (id: number | null) => {
    const rel = id != null ? pathOf.get(id) : null;
    const segs = rel ? splitRelative(rel) : null;
    return segs ? path.join(mediaRoot(), ...segs) : null;
  };

  const outFolder = renderFolder("script", ownerRef, opts.language);
  const kit = await getBrandKit(script.brandId);
  const color = cardColor(kit?.colors?.[0]?.hex);
  const size = FORMAT_SIZE[opts.format];
  const mediaDir = path.join(mediaRoot(), String(script.id));
  const available = await filesIn(mediaDir);
  const cardsDir = path.join(mediaRoot(), ...splitRelative(outFolder)!, "cards");

  const scenes: RenderScene[] = [];
  const noAudio: string[] = [];
  for (const block of blocks) {
    const take = takes.get(block.sceneRef)!;
    const audioPath = absolute(take.masterAssetId) ?? absolute(take.playbackAssetId);
    if (!audioPath || !take.durationMs) {
      noAudio.push(`${block.sceneRef} (${block.label})`);
      continue;
    }
    let visual = pickVisual(mediaDir, block.shots, available);
    if (!visual) {
      await mkdir(cardsDir, { recursive: true });
      const file = path.join(cardsDir, `${block.sceneRef}-${opts.format}.png`);
      await renderTitleCard(file, {
        width: size.width,
        height: size.height,
        text: block.onScreenText.join(" · "),
        background: color,
      });
      visual = { file, kind: "image" };
    }
    scenes.push({
      sceneRef: block.sceneRef,
      visualPath: visual.file,
      visualKind: visual.kind,
      audioPath,
      audioDurationMs: take.durationMs,
      captionText: take.inputText || block.spokenText,
      alignment: take.alignment ?? null,
    });
  }
  if (noAudio.length) {
    throw new ScriptRenderRefusedError(
      `The selected take has no audio file or duration for: ${noAudio.join(", ")}.`,
    );
  }

  return {
    ownerKind: "script",
    ownerRef,
    language: opts.language,
    format: opts.format,
    scenes,
    musicPath: opts.musicPath ?? null,
    musicDb: opts.musicDb,
    burnCaptions: opts.burnCaptions ?? false,
    outFolder,
    outName: `script-${script.id}-${opts.language.toLowerCase()}-${opts.format}`,
    brandId: script.brandId,
  };
}
