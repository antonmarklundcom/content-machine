import "server-only";

import type { HiggsfieldJobKind } from "@/db/schema";
import { getBrand } from "@/lib/bridge/brands";
import { getBrandKit } from "@/lib/bridge/families";
import { getScript } from "@/lib/bridge/scripts";
import { exportBrief, PostEngineError } from "@/lib/posts/engine";
import { validateScriptBody, type ScriptBodyV1 } from "@/lib/scripts/contract";
import {
  shotList,
  shotListMarkdown,
  thumbnailList,
  thumbnailListMarkdown,
} from "@/lib/scripts/export";
import { higgsfieldInboxFolder } from "@/lib/storage/paths";

import { targetId } from "./config";

/**
 * What follows the slash command in a run's prompt (build 4 §1.14): the same
 * brief the export routes serve, generated here so the CLI never has to fetch
 * it with a session cookie.
 */

export class HiggsfieldInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HiggsfieldInputError";
  }
}

export type BriefRequest = {
  kind: HiggsfieldJobKind;
  targetRef?: string | null;
  brandId?: string | null;
  /** `free`: what to make. */
  description?: string | null;
  /** `import`: `since YYYY-MM-DD`, `last N` or `all`; empty = the command's default. */
  range?: string | null;
};

export type BuiltBrief = { argument: string; brandId: string | null; targetRef: string | null };

const RANGE = /^(since \d{4}-\d{2}-\d{2}|last \d{1,4}|all)$/i;

async function scriptFor(targetRef: string | null | undefined) {
  const id = targetId(targetRef);
  if (!id || !targetRef?.startsWith("script:"))
    throw new HiggsfieldInputError("Pick a script (script:<id>).");
  const row = await getScript(id);
  if (!row) throw new HiggsfieldInputError(`No script ${id}.`);
  const verdict = validateScriptBody(row.body);
  if (!verdict.ok) throw new HiggsfieldInputError(`Script ${id} has no valid body to export.`);
  return {
    targetRef,
    script: {
      id: row.id,
      brandId: row.brandId,
      status: row.status,
      body: row.body as ScriptBodyV1,
    },
  };
}

export async function buildBriefArgument(req: BriefRequest, now = new Date()): Promise<BuiltBrief> {
  switch (req.kind) {
    case "post": {
      const id = targetId(req.targetRef);
      if (!id || !req.targetRef?.startsWith("post:"))
        throw new HiggsfieldInputError("Pick a post (post:<id>).");
      try {
        const brief = await exportBrief(id);
        if (!brief.json.visuals.length)
          throw new HiggsfieldInputError(`Post ${id} has no visuals to generate.`);
        return { argument: brief.markdown, brandId: brief.json.brandId, targetRef: req.targetRef };
      } catch (error) {
        if (error instanceof PostEngineError) throw new HiggsfieldInputError(error.message);
        throw error;
      }
    }
    case "script_shots": {
      const { targetRef, script } = await scriptFor(req.targetRef);
      return {
        argument: shotListMarkdown(shotList(script)),
        brandId: script.brandId,
        targetRef,
      };
    }
    case "script_thumbnails": {
      const { targetRef, script } = await scriptFor(req.targetRef);
      return {
        argument: thumbnailListMarkdown(thumbnailList(script)),
        brandId: script.brandId,
        targetRef,
      };
    }
    case "import": {
      const range = (req.range ?? "").trim();
      if (range && !RANGE.test(range))
        throw new HiggsfieldInputError("Range must be `since YYYY-MM-DD`, `last N` or `all`.");
      return { argument: range, brandId: null, targetRef: null };
    }
    case "free": {
      const description = (req.description ?? "").trim();
      if (description.length < 5)
        throw new HiggsfieldInputError("Describe the images or videos to make.");
      if (description.length > 4000)
        throw new HiggsfieldInputError("Keep the description under 4000 characters.");
      const brandId = req.brandId?.trim() || null;
      const brand = brandId ? await getBrand(brandId) : null;
      if (brandId && !brand) throw new HiggsfieldInputError(`No brand ${brandId}.`);
      const kit = brandId ? await getBrandKit(brandId) : null;
      const folder = higgsfieldInboxFolder(now);
      const json = {
        brandId,
        brandName: brand?.name ?? null,
        folder,
        request: description,
        kit: kit
          ? {
              higgsfieldElementIds: kit.higgsfield?.elementIds ?? [],
              higgsfieldCharacterIds: kit.higgsfield?.characterIds ?? [],
              styleNotes: kit.higgsfield?.styleNotes ?? "",
              colors: kit.colors,
            }
          : null,
      };
      const lines = [
        `# Free prompt${brand ? ` — ${brand.name}` : ""}`,
        "",
        `- Brand: ${brandId ?? "(none — unsorted)"}`,
        `- Folder: \`${folder}/\` (save \`manifest.json\` here too)`,
        "",
        "## What to make",
        "",
        description,
        "",
        "```json",
        JSON.stringify(json, null, 2),
        "```",
        "",
      ];
      return { argument: lines.join("\n"), brandId, targetRef: null };
    }
    case "voice":
      // Build 5 §3.A: a voice batch's argument is its line manifest, built by
      // src/lib/higgsfield/voice.ts — never from a brief.
      throw new HiggsfieldInputError("Voice jobs are queued from a story, a script or /voice.");
  }
}
