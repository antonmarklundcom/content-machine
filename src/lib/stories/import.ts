import { insertReturning } from "@/db/mutations";
/**
 * The cuentos importer (build 4 §3.C.2): `CUENTOS_ROOT/books/<slug>/` →
 * `stories` + `story_scenes`. Read-only on CUENTOS_ROOT. Re-runnable: stories
 * upsert by slug, scenes by (story, scene id); an in-app approval survives a
 * re-import unless the repo's status or the text changed.
 */
import { assertOnPc } from "@/lib/pc-only";
import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { stories, storyScenes, type StoryScene } from "@/db/schema";
import { listBookSlugs, loadBook, requireCuentosRoot } from "./book";
import { mergeSceneStatus, readSceneMeta, writeSceneMeta } from "./meta";

export type StoryImportResult = {
  slug: string;
  status: "created" | "updated" | "unchanged" | "failed";
  title?: string;
  scenesAdded: string[];
  scenesChanged: string[];
  scenesRemoved: string[];
  approvalsKept: string[];
  approvalsDropped: string[];
  warnings: string[];
  unknownFiles: string[];
  error?: string;
};

export type ImportReport = { at: string; root: string; results: StoryImportResult[] };

/** What `stories.notes` holds: the last import's report for the book. */
export type StoryNotes = { lastImport?: StoryImportResult & { at: string } };

export function readStoryNotes(notes: string | null | undefined): StoryNotes {
  if (!notes) return {};
  try {
    const v = JSON.parse(notes) as unknown;
    return typeof v === "object" && v !== null ? (v as StoryNotes) : {};
  } catch {
    return {};
  }
}

/** JSON equality that ignores object key order. */
function stable(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.keys(v as object)
        .sort()
        .map((k) => [k, stable((v as Record<string, unknown>)[k])]),
    );
  }
  return v;
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(stable(a)) === JSON.stringify(stable(b));
}

/** Import one book. Never throws for content problems; a story.json that cannot be read is a `failed` result. */
export async function importStory(
  root: string,
  slug: string,
  now = new Date(),
): Promise<StoryImportResult> {
  const result: StoryImportResult = {
    slug,
    status: "unchanged",
    scenesAdded: [],
    scenesChanged: [],
    scenesRemoved: [],
    approvalsKept: [],
    approvalsDropped: [],
    warnings: [],
    unknownFiles: [],
  };
  let book;
  try {
    book = await loadBook(root, slug);
  } catch (err) {
    return { ...result, status: "failed", error: err instanceof Error ? err.message : String(err) };
  }
  const { parsed, raw, sha, artSize } = book;
  result.title = parsed.title;
  result.warnings = parsed.report.warnings;
  result.unknownFiles = parsed.report.unknownFiles;

  await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(stories).where(eq(stories.slug, slug)).limit(1);
    const values = {
      title: parsed.title,
      series: parsed.series,
      ageBand: parsed.ageBand,
      sourcePath: `books/${slug}`,
      sourceSha: sha,
      raw,
      languages: parsed.languages,
      importedAt: now,
      updatedAt: now,
    };
    let storyId: number;
    if (existing) {
      storyId = existing.id;
      const changed =
        existing.sourceSha !== sha ||
        existing.title !== parsed.title ||
        existing.series !== parsed.series ||
        existing.ageBand !== parsed.ageBand ||
        !sameJson(existing.languages, parsed.languages);
      if (changed) result.status = "updated";
      await tx.update(stories).set(values).where(eq(stories.id, storyId));
    } else {
      const [created] = await insertReturning(tx, stories, { slug, ...values }, { id: stories.id });
      storyId = created.id;
      result.status = "created";
    }

    const rows = await tx.select().from(storyScenes).where(eq(storyScenes.storyId, storyId));
    const byRef = new Map<string, StoryScene>(rows.map((r) => [r.sceneRef, r]));

    for (const scene of parsed.scenes) {
      const row = byRef.get(scene.sceneRef);
      byRef.delete(scene.sceneRef);
      const size = artSize.get(scene.sceneRef);
      const merged = mergeSceneStatus(scene, readSceneMeta(row?.notes));
      result.approvalsKept.push(...merged.kept);
      result.approvalsDropped.push(...merged.dropped);
      const next = {
        position: scene.position,
        kind: scene.kind,
        text: scene.text,
        textStatus: merged.textStatus,
        lines: scene.lines,
        artPath: scene.artPath,
        artWidth: size?.width ?? null,
        artHeight: size?.height ?? null,
        alt: scene.alt,
        artBrief: scene.artBrief,
        notes: writeSceneMeta(merged.meta),
      };
      if (!row) {
        await tx
          .insert(storyScenes)
          .values({ storyId, sceneRef: scene.sceneRef, ...next, updatedAt: now });
        if (existing) result.scenesAdded.push(scene.sceneRef);
        continue;
      }
      const changed =
        row.position !== next.position ||
        row.kind !== next.kind ||
        !sameJson(row.text, next.text) ||
        !sameJson(row.textStatus, next.textStatus) ||
        !sameJson(row.lines, next.lines) ||
        row.artPath !== next.artPath ||
        row.artWidth !== next.artWidth ||
        row.artHeight !== next.artHeight ||
        row.alt !== next.alt ||
        row.artBrief !== next.artBrief ||
        row.notes !== next.notes;
      if (changed) {
        result.scenesChanged.push(scene.sceneRef);
        await tx
          .update(storyScenes)
          .set({ ...next, updatedAt: now })
          .where(eq(storyScenes.id, row.id));
      }
    }

    // Scenes no longer in story.json: removed here. Their takes stay in the
    // take history (narrations), so a scene that comes back finds them again.
    const gone = [...byRef.values()];
    if (gone.length) {
      await tx.delete(storyScenes).where(
        and(
          eq(storyScenes.storyId, storyId),
          inArray(
            storyScenes.id,
            gone.map((g) => g.id),
          ),
        ),
      );
      result.scenesRemoved.push(...gone.map((g) => g.sceneRef));
    }
    if (
      result.status === "unchanged" &&
      (result.scenesAdded.length || result.scenesChanged.length || result.scenesRemoved.length)
    ) {
      result.status = "updated";
    }

    const notes = JSON.stringify({ lastImport: { ...result, at: now.toISOString() } });
    await tx.update(stories).set({ notes }).where(eq(stories.id, storyId));
  });
  return result;
}

/** Import every book (or one slug). Throws `CuentosRootError` when CUENTOS_ROOT is unusable. */
export async function importStories(slug?: string, now = new Date()): Promise<ImportReport> {
  assertOnPc("Importing stories from CUENTOS_ROOT");
  const root = await requireCuentosRoot();
  const slugs = slug ? [slug] : await listBookSlugs(root);
  const results: StoryImportResult[] = [];
  for (const s of slugs) results.push(await importStory(root, s, now));
  return { at: now.toISOString(), root, results };
}
