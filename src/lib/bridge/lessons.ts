import { deleteReturning, insertReturning } from "@/db/mutations";
import "server-only";
import { and, desc, eq, isNull, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { LESSON_KINDS, lessons, videos, type Lesson, type LessonKind } from "@/db/schema";

/**
 * Saved lessons (PLAN.md §1.31): hooks, facts, title patterns and lessons
 * pulled by hand out of a digest. Always saved by a person, never by a model —
 * nothing in the pipeline calls `createLesson`.
 *
 * Writes as well as reads: lane 2 (§4.7) reaches data only through this
 * directory, and saving a lesson is S11's whole feature.
 */

export class InvalidLessonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidLessonError";
  }
}

export type NewLessonInput = {
  text: string;
  kind?: LessonKind;
  brandId?: string | null;
  videoId?: number | null;
  timestampSec?: number | null;
  sourceUrl?: string | null;
};

/** Save one lesson; trims the text and rejects an empty one or an unknown kind. */
export async function createLesson(input: NewLessonInput): Promise<Lesson> {
  const text = input.text.trim();
  if (!text) throw new InvalidLessonError("A lesson needs some text.");
  const kind = input.kind ?? "lesson";
  if (!(LESSON_KINDS as readonly string[]).includes(kind)) {
    throw new InvalidLessonError(
      `Unknown kind "${kind}". Expected one of: ${LESSON_KINDS.join(", ")}.`,
    );
  }
  const timestampSec =
    input.timestampSec === null || input.timestampSec === undefined
      ? null
      : Math.max(0, Math.floor(input.timestampSec));
  const sourceUrl = input.sourceUrl?.trim() || null;
  if (sourceUrl && sourceUrl.length > 1024) {
    throw new InvalidLessonError("The source URL is longer than 1024 characters.");
  }

  const [row] = await insertReturning(db, lessons, {
    text,
    kind,
    brandId: input.brandId || null,
    videoId: input.videoId ?? null,
    timestampSec,
    sourceUrl,
  });
  if (!row) throw new Error("Insert into lessons returned no row");
  return row;
}

export type LessonsQuery = {
  /** A brand's lessons. `null` means portfolio-wide ones only; omitted means all. */
  brandId?: string | null;
  kind?: LessonKind;
  videoId?: number;
  /** Case-insensitive substring of the text. */
  search?: string;
  /** Default 200, max 1000. */
  limit?: number;
};

/** A lesson with the video it came from, when it came from one. */
export type LessonWithVideo = Lesson & {
  videoYoutubeId: string | null;
  videoTitle: string | null;
};

function lessonFilters(query: LessonsQuery): SQL | undefined {
  const conditions: (SQL | undefined)[] = [
    query.brandId === null
      ? isNull(lessons.brandId)
      : query.brandId !== undefined
        ? eq(lessons.brandId, query.brandId)
        : undefined,
    query.kind ? eq(lessons.kind, query.kind) : undefined,
    query.videoId !== undefined ? eq(lessons.videoId, query.videoId) : undefined,
    query.search?.trim()
      ? sql`lower(${lessons.text}) like lower(${`%${query.search.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`})`
      : undefined,
  ];
  const present = conditions.filter((c): c is SQL => c !== undefined);
  return present.length ? and(...present) : undefined;
}

/** Lessons filtered by brand/kind/video/text, newest first, with their video's title. */
export async function listLessons(query: LessonsQuery = {}): Promise<LessonWithVideo[]> {
  const limit = Math.min(1000, Math.max(1, Math.floor(query.limit ?? 200)));
  const rows = await db
    .select({ lesson: lessons, videoYoutubeId: videos.youtubeId, videoTitle: videos.title })
    .from(lessons)
    .leftJoin(videos, eq(videos.id, lessons.videoId))
    .where(lessonFilters(query))
    .orderBy(desc(lessons.createdAt), desc(lessons.id))
    .limit(limit);
  return rows.map((r) => ({
    ...r.lesson,
    videoYoutubeId: r.videoYoutubeId,
    videoTitle: r.videoTitle,
  }));
}

/** Delete one lesson; true if it existed. */
export async function deleteLesson(id: number): Promise<boolean> {
  const rows = await deleteReturning(db, lessons, eq(lessons.id, id), { id: lessons.id });
  return rows.length > 0;
}

const KIND_HEADINGS: Record<LessonKind, string> = {
  lesson: "Lessons",
  hook: "Hooks",
  title_pattern: "Title patterns",
  fact: "Facts",
  cta: "CTAs",
  caption_pattern: "Caption patterns",
};

/** `m:ss` or `h:mm:ss`, as YouTube shows it. */
function clock(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** One line of provenance: the video (at its timestamp) and/or the source URL. */
function provenance(lesson: LessonWithVideo): string {
  const parts: string[] = [];
  if (lesson.videoYoutubeId) {
    const at = lesson.timestampSec !== null ? `&t=${lesson.timestampSec}s` : "";
    const label = `${lesson.videoTitle ?? lesson.videoYoutubeId}${
      lesson.timestampSec !== null ? ` @ ${clock(lesson.timestampSec)}` : ""
    }`;
    parts.push(`[${label}](https://www.youtube.com/watch?v=${lesson.videoYoutubeId}${at})`);
  }
  if (lesson.sourceUrl) parts.push(`<${lesson.sourceUrl}>`);
  return parts.length ? ` — ${parts.join(" · ")}` : "";
}

/**
 * The same filter as `listLessons`, as Markdown grouped by kind — what a
 * script prompt or a notes file takes (§1.31). Empty kinds are left out.
 */
export async function exportLessonsMarkdown(
  query: Omit<LessonsQuery, "limit"> = {},
  options: { title?: string } = {},
): Promise<string> {
  const rows = await listLessons({ ...query, limit: 1000 });
  const title =
    options.title ??
    (query.brandId
      ? `Lessons — ${query.brandId}`
      : query.brandId === null
        ? "Lessons — all brands"
        : "Lessons");
  const out: string[] = [`# ${title}`, ""];
  if (rows.length === 0) {
    out.push("_No lessons saved yet._", "");
    return out.join("\n");
  }
  for (const kind of LESSON_KINDS) {
    const ofKind = rows.filter((r) => r.kind === kind);
    if (ofKind.length === 0) continue;
    out.push(`## ${KIND_HEADINGS[kind]}`, "");
    for (const lesson of ofKind) {
      // One bullet per lesson: continuation lines indented so a multi-line
      // lesson stays inside its bullet.
      const text = lesson.text.split("\n").join("\n  ");
      out.push(`- ${text}${provenance(lesson)}`);
    }
    out.push("");
  }
  return out.join("\n");
}
