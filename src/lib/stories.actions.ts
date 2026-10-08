"use server";

/**
 * The story studio's writes (build 4 §3.C.8). Owner only: narrating costs
 * money, approving text is the owner's word, and export writes into the
 * cuentos repo. Results carry dictionary keys plus English detail lines.
 */

import { revalidatePath } from "next/cache";
import { after } from "next/server";

import { ForbiddenError } from "@/lib/auth/roles";
import { requireOwner } from "@/lib/auth/session";
import { exportToCuentos } from "@/lib/stories/export";
import { importStories } from "@/lib/stories/import";
import {
  approveSceneText,
  approveStoryLanguage,
  buildSceneAudio,
  narrateScene,
  queueStoryRender,
  reviewSceneTake,
  revokeSceneApproval,
  selectSceneTake,
} from "@/lib/stories/studio";
import { storyErrorResult, type StoryActionResult } from "@/lib/stories/result";
import { parseMusicDb, resolveMusicPath } from "@/lib/media/music";
import { mediaRoot } from "@/lib/storage/root";
import { VIDEO_FORMATS, type VideoFormat } from "@/lib/video/contract";
import { TAKE_REVIEW_STATUSES, type TakeReviewStatus } from "@/lib/voice/contract";

/**
 * The owner gate first (a signed-out visitor is redirected, an employee gets
 * a refusal), then the work; expected refusals come back as results.
 */
async function asOwner(
  what: string,
  slug: string | null,
  run: (by: string) => Promise<StoryActionResult>,
): Promise<StoryActionResult> {
  let by: string;
  try {
    by = (await requireOwner(what)).email;
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, error: "stories.error.owner" };
    throw err;
  }
  try {
    const result = await run(by);
    revalidatePath("/stories");
    if (slug) revalidatePath(`/stories/${slug}`);
    return result;
  } catch (err) {
    return storyErrorResult(err);
  }
}

function field(formData: FormData, name: string): string {
  const v = formData.get(name);
  return typeof v === "string" ? v.trim() : "";
}

function positiveInt(v: string): number | null {
  return /^\d{1,9}$/.test(v) && Number(v) > 0 ? Number(v) : null;
}

export async function importStoriesAction(
  _prev: StoryActionResult | null,
  formData: FormData,
): Promise<StoryActionResult> {
  return asOwner("import stories", null, async () => {
    const slug = field(formData, "slug") || undefined;
    const report = await importStories(slug);
    const lines: string[] = [];
    for (const r of report.results) {
      if (r.status === "failed") {
        lines.push(`✗ ${r.slug}: ${r.error}`);
        continue;
      }
      lines.push(`${r.slug} — ${r.status}`);
      if (r.scenesAdded.length) lines.push(`  + ${r.scenesAdded.join(", ")}`);
      if (r.scenesChanged.length) lines.push(`  ~ ${r.scenesChanged.join(", ")}`);
      if (r.scenesRemoved.length) lines.push(`  − ${r.scenesRemoved.join(", ")}`);
      for (const d of r.approvalsDropped) lines.push(`  approval dropped: ${d}`);
      for (const w of r.warnings) lines.push(`  ! ${w}`);
      if (r.unknownFiles.length) lines.push(`  ? ${r.unknownFiles.join(", ")}`);
    }
    return {
      ok: true,
      message: "stories.import.done",
      vars: { count: report.results.filter((r) => r.status !== "failed").length },
      lines,
    };
  });
}

export async function approveTextAction(
  slug: string,
  sceneRef: string,
  lang: string,
): Promise<StoryActionResult> {
  return asOwner("approve story text", slug, async (by) => {
    const r = await approveSceneText(slug, sceneRef, lang, by);
    return {
      ok: true,
      message: r === "already" ? "stories.approve.already" : "stories.approve.done",
    };
  });
}

export async function approveLanguageAction(
  slug: string,
  lang: string,
): Promise<StoryActionResult> {
  return asOwner("approve story text", slug, async (by) => {
    const r = await approveStoryLanguage(slug, lang, by);
    return {
      ok: true,
      message: "stories.approveAll.done",
      vars: { approved: r.approved.length, already: r.already.length, skipped: r.skipped.length },
      lines: r.skipped.map((s) => `${s.sceneRef}: ${s.reason}`),
    };
  });
}

export async function revokeApprovalAction(
  slug: string,
  sceneRef: string,
  lang: string,
): Promise<StoryActionResult> {
  return asOwner("revoke a story text approval", slug, async () => {
    await revokeSceneApproval(slug, sceneRef, lang);
    return { ok: true, message: "stories.approve.revoked" };
  });
}

export async function narrateSceneAction(
  slug: string,
  sceneRef: string,
  lang: string,
  _prev: StoryActionResult | null,
  formData: FormData,
): Promise<StoryActionResult> {
  return asOwner("narrate a story scene", slug, async () => {
    const speakerProfiles: Record<string, number> = {};
    for (const [k, v] of formData.entries()) {
      if (k.startsWith("speaker:") && typeof v === "string") {
        const id = positiveInt(v);
        if (id) speakerProfiles[k.slice("speaker:".length)] = id;
      }
    }
    const r = await narrateScene({
      slug,
      sceneRef,
      lang,
      narratorProfileId: positiveInt(field(formData, "narrator")),
      speakerProfiles,
      all: field(formData, "all") === "1",
    });
    return {
      ok: true,
      message: "stories.narrate.done",
      vars: { count: r.takes.length },
      lines: [
        ...r.takes.map(
          (t) =>
            `${t.slot}: ${Math.round(t.result.durationMs / 100) / 10} s${t.selected ? " ✓" : ""}`,
        ),
        ...r.notes,
      ],
    };
  });
}

export async function selectTakeAction(
  slug: string,
  narrationId: number,
): Promise<StoryActionResult> {
  return asOwner("select a take", slug, async () => {
    const r = await selectSceneTake(slug, narrationId);
    return { ok: true, message: "stories.take.selected", lines: r.notes };
  });
}

export async function reviewTakeAction(
  slug: string,
  narrationId: number,
  status: TakeReviewStatus,
): Promise<StoryActionResult> {
  return asOwner("review a take", slug, async (by) => {
    if (!(TAKE_REVIEW_STATUSES as readonly string[]).includes(status))
      return { ok: false, error: "stories.error.failed" };
    await reviewSceneTake(slug, narrationId, status, by);
    return { ok: true, message: "stories.take.reviewed" };
  });
}

export async function buildSceneAudioAction(
  slug: string,
  sceneRef: string,
  lang: string,
): Promise<StoryActionResult> {
  return asOwner("build scene audio", slug, async () => {
    const a = await buildSceneAudio(slug, sceneRef, lang);
    return {
      ok: true,
      message: "stories.audio.built",
      vars: { seconds: Math.round(a.durationMs / 100) / 10 },
    };
  });
}

/**
 * Queues the story render (build 5 E) and returns at once with the render id;
 * the page lists the row and refreshes itself until it is done or failed.
 */
export async function renderStoryAction(
  slug: string,
  _prev: StoryActionResult | null,
  formData: FormData,
): Promise<StoryActionResult> {
  return asOwner("render a story video", slug, async () => {
    const format = field(formData, "format") as VideoFormat;
    if (!(VIDEO_FORMATS as readonly string[]).includes(format))
      return { ok: false, error: "stories.error.failed" };
    const music = field(formData, "music");
    const musicPath = music ? resolveMusicPath(music, mediaRoot()) : null;
    if (music && !musicPath)
      return { ok: false, error: "stories.error.music", detail: `Not a music file: ${music}` };
    const r = await queueStoryRender({
      slug,
      lang: field(formData, "lang"),
      format,
      sample: field(formData, "mode") !== "full",
      musicPath,
      musicDb: musicPath ? parseMusicDb(field(formData, "musicDb")) : undefined,
    });
    const settle = () => r.done.then(() => undefined).catch(() => undefined);
    try {
      after(settle);
    } catch {
      void settle();
    }
    revalidatePath("/video");
    return {
      ok: true,
      message: "stories.render.queued",
      vars: { id: r.renderId },
      lines: [`scenes: ${r.sceneRefs.join(", ")}`],
    };
  });
}

export async function exportStoryAction(
  slug: string,
  _prev: StoryActionResult | null,
  formData: FormData,
): Promise<StoryActionResult> {
  return asOwner("export to cuentos", slug, async () => {
    const r = await exportToCuentos(slug, field(formData, "lang"));
    return {
      ok: true,
      message: "stories.export.done",
      vars: { count: r.written.length },
      lines: [
        ...r.written,
        ...r.skipped.map((s) => `skipped: ${s}`),
        ...(r.missing.length ? [`not ready: ${r.missing.join(", ")}`] : []),
        r.manifestPath,
      ],
    };
  });
}
