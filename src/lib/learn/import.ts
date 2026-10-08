import { insertIfAbsent } from "@/db/mutations";
import "server-only";
import { inArray } from "drizzle-orm";

import { db } from "@/db";
import { clips } from "@/db/schema";
import { normalizeTags } from "@/lib/clips/save";
import { canonicalClipUrl, CLIP_URL_LIMIT, platformForUrl } from "@/lib/clips/url";

import { toLearnCategory } from "./categories";

/**
 * One-time import of aiinsights' `items` table into learn clips
 * (`npm run learn:import-aiinsights`, docs/LEARN.md). Idempotent by canonical
 * URL: `insert … on conflict (url) do nothing`, so a second run inserts
 * nothing and a link already in the inbox (saved some other way) is left as
 * it is.
 *
 * Column names are aiinsights' (its src/db/schema.ts); rows are read with
 * `select *` so an aiinsights database that never ran its later migrations
 * (no `committed_at`, `dismissed_at`) still imports.
 */

/** A raw `items` row, snake_case as Postgres returns it. */
export type AiinsightsRow = Record<string, unknown>;

export type ImportedClip = typeof clips.$inferInsert & { url: string };

/** Every imported clip carries this tag, so the import can be found (and undone) later. */
export const IMPORT_TAG = "aiinsights";

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

function date(v: unknown): Date | null {
  if (v === null || v === undefined || v === "") return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

function stringList(v: unknown): string[] {
  let list = v;
  if (typeof v === "string") {
    try {
      list = JSON.parse(v);
    } catch {
      return [];
    }
  }
  return Array.isArray(list) ? list.map((s) => String(s).trim()).filter(Boolean) : [];
}

/**
 * aiinsights saved a screenshot without a link as `tg://photo/<file_id>`.
 * `clips.url` must be http(s), so it becomes a reserved `.invalid` host keyed
 * the same way — stable, so a re-run finds the same row.
 */
export function aiinsightsUrl(row: AiinsightsRow): string | null {
  const raw = text(row.url);
  const photo = raw?.match(/^tg:\/\/photo\/(.+)$/);
  if (photo) return `https://telegram.invalid/aiinsights/${encodeURIComponent(photo[1]!)}`;
  const canonical = raw ? canonicalClipUrl(raw) : null;
  if (canonical && canonical.length <= CLIP_URL_LIMIT) return canonical;
  // Not a usable link at all: keyed by the aiinsights id, still stable.
  return row.id !== undefined && row.id !== null
    ? `https://telegram.invalid/aiinsights/item-${encodeURIComponent(String(row.id))}`
    : null;
}

/** One aiinsights item → the learn clip to insert, or null when it has no usable key. */
export function mapAiinsightsItem(row: AiinsightsRow): ImportedClip | null {
  const url = aiinsightsUrl(row);
  if (!url) return null;
  const summary = text(row.summary);
  const repoUrl = text(row.repo_url);
  // The repo goes in the note when it is not the link itself, so learn:process finds it.
  const sameAsLink = repoUrl !== null && canonicalClipUrl(repoUrl) === url;
  const noteParts = [text(row.user_note), repoUrl && !sameAsLink ? `Repo: ${repoUrl}` : null];
  const note = noteParts.filter(Boolean).join("\n") || null;
  const saved = date(row.created_at) ?? new Date();
  const implemented = row.implemented === true || row.implemented === "t";
  const tags = normalizeTags([
    ...stringList(row.tags),
    IMPORT_TAG,
    ...(date(row.dismissed_at) ? ["aiinsights-dismissed"] : []),
  ]);
  const steps = stringList(row.how_to_start);
  const isPhoto = /^tg:\/\/photo\//.test(text(row.url) ?? "");

  return {
    url,
    platform: isPhoto ? "other" : platformForUrl(url),
    purpose: "learn",
    source: "telegram",
    note,
    title: text(row.title)?.slice(0, 512) ?? null,
    postText: text(row.source_caption),
    transcript: text(row.transcript),
    summary,
    // A category without a summary is not a finished item: leave it for learn:process.
    learnCategory: summary ? toLearnCategory(row.category) : null,
    howToStart: steps.length ? steps : null,
    tags,
    telegramFileId: text(row.image_file_id)?.slice(0, 255) ?? null,
    implementedAt: implemented ? (date(row.updated_at) ?? saved) : null,
    committedAt: implemented ? null : date(row.committed_at),
    savedAt: saved,
  };
}

/** Reads the source table. `query` is a pg pool or Neon's `sql` function. */
export type SourceQuery = (text: string) => Promise<AiinsightsRow[]>;

export async function readAiinsightsItems(
  query: SourceQuery,
  table = "items",
): Promise<AiinsightsRow[]> {
  if (!/^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)?$/i.test(table)) {
    throw new Error(`Not a table name: ${table}`);
  }
  return query(`select * from ${table} order by id asc`);
}

export type ImportReport = {
  read: number;
  inserted: number;
  /** Already in clips (same canonical URL), or a duplicate within the source. */
  existing: number;
  /** No usable URL or id. */
  unusable: number;
  dryRun: boolean;
  urls: string[];
};

export async function importAiinsights(
  rows: readonly AiinsightsRow[],
  options: { dryRun?: boolean } = {},
): Promise<ImportReport> {
  const mapped = new Map<string, ImportedClip>();
  let unusable = 0;
  let duplicates = 0;
  for (const row of rows) {
    const clip = mapAiinsightsItem(row);
    if (!clip) unusable++;
    else if (mapped.has(clip.url)) duplicates++;
    else mapped.set(clip.url, clip);
  }
  const values = [...mapped.values()];
  const report = (inserted: string[]): ImportReport => ({
    read: rows.length,
    inserted: inserted.length,
    existing: values.length - inserted.length + duplicates,
    unusable,
    dryRun: Boolean(options.dryRun),
    urls: inserted,
  });
  if (values.length === 0) return report([]);

  if (options.dryRun) {
    const present = new Set<string>();
    for (let i = 0; i < values.length; i += 500) {
      const chunk = values.slice(i, i + 500).map((v) => v.url);
      const found = await db
        .select({ url: clips.url })
        .from(clips)
        .where(inArray(clips.url, chunk));
      for (const f of found) present.add(f.url);
    }
    return report(values.map((v) => v.url).filter((u) => !present.has(u)));
  }

  const inserted: string[] = [];
  for (let i = 0; i < values.length; i += 200) {
    const rowsIn = await insertIfAbsent(
      db,
      clips,
      values.slice(i, i + 200),
      { target: clips.url },
      { url: clips.url },
    );
    inserted.push(...rowsIn.map((r) => r.url));
  }
  return report(inserted);
}
