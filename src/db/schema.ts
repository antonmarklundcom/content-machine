import { relations, sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  char,
  date,
  index,
  int,
  json,
  decimal,
  mysqlTable,
  primaryKey,
  double,
  smallint,
  longtext,
  datetime,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";
import type {
  ConsentStatus,
  LexiconReviewStatus,
  VoiceSettings,
  WordTiming,
} from "@/lib/voice/contract";
import {
  CONSENT_STATUSES,
  LEXICON_REVIEW_STATUSES,
  NARRATION_OWNER_KINDS,
  NARRATION_STATUSES,
  TAKE_REVIEW_STATUSES,
  VOICE_PROVIDERS,
  VOICE_ROLES,
} from "@/lib/voice/contract";
import { RENDER_OWNER_KINDS, RENDER_STATUSES, VIDEO_FORMATS } from "@/lib/video/contract";
import type {
  AnalysisGap,
  AnalysisHook,
  AnalysisIdea,
  AnalysisTimelineEntry,
  OutlinePayload,
} from "@/lib/analysis/contract";

// =============================================================================
// Content (brand ideation) — content-engine's original tables.
// =============================================================================

export const FORMATS = ["reel", "carousel", "image_post", "story"] as const;
export type Format = (typeof FORMATS)[number];

/**
 * `posted` (PLAN.md §1.23) is terminal for the app's purposes: the idea went
 * out, by hand — there is no posting integration and no scheduling.
 */
export const IDEA_STATUSES = ["proposed", "approved", "rejected", "posted"] as const;
export type IdeaStatus = (typeof IDEA_STATUSES)[number];

// One row per business/brand. Drives which content gets researched/written
// for whom, in what voice, on which platforms. Nothing here is specific to
// any one business — niche/voice/market/platforms are what generation reads
// to tailor itself per brand.
export const brands = mysqlTable("brands", {
  id: varchar("id", { length: 255 }).primaryKey(), // slug, e.g. "pozo"
  name: varchar("name", { length: 255 }).notNull(),
  domain: longtext("domain").notNull(),
  niche: longtext("niche").notNull(), // e.g. "well drilling / water"
  market: varchar("market", { length: 255 }).notNull(), // "paraguay" | "sweden" | "global"
  language: varchar("language", { length: 16 }).notNull().default("es"), // es | en | sv
  voice: longtext("voice"), // tone/style notes for research + copy
  platforms: json("platforms").$type<string[]>().notNull(), // ["instagram","facebook",...]
  active: boolean("active").notNull().default(true),
  /** Soft link to `brand_families.id` (PLAN.md §1.40). Null is a brand on its own. */
  familyId: varchar("family_id", { length: 255 }),
  createdAt: datetime("created_at", { mode: "date", fsp: 3 })
    .notNull()
    .default(sql`(current_timestamp(3))`),
});

// A research finding worth sharing across brands — e.g. "Paraguay approves
// new investor visa rules" is relevant to both guide and propia; a
// tax-law change is relevant to contador and negocio. Written once, tagged
// with every brand it applies to, instead of every brand re-researching the
// same topic from scratch.
export const researchNotes = mysqlTable("research_notes", {
  id: int("id").primaryKey().autoincrement(),
  topic: longtext("topic").notNull(),
  summary: longtext("summary").notNull(),
  market: varchar("market", { length: 255 }).notNull(),
  relatedBrandIds: json("related_brand_ids").$type<string[]>().notNull(),
  sources: json("sources").$type<string[]>(),
  createdAt: datetime("created_at", { mode: "date", fsp: 3 })
    .notNull()
    .default(sql`(current_timestamp(3))`),
});

// The actual deliverable: a content idea with ready-to-post copy. Produced
// by the /api/generate research+ideation call for a brand, reviewed by the
// user, and approved/rejected.
export const ideas = mysqlTable("ideas", {
  id: int("id").primaryKey().autoincrement(),
  brandId: varchar("brand_id", { length: 255 }).notNull(),
  title: longtext("title").notNull(),
  angle: longtext("angle").notNull(), // why this idea, the hook
  format: varchar("format", { length: 64, ...{ enum: FORMATS } }).notNull(),
  platform: varchar("platform", { length: 64 }).notNull(), // "instagram" | "facebook" | "tiktok" | ...
  // Ready-to-post caption: hook line, body, call-to-action, hashtags — in
  // the brand's voice/language. This is the point of the whole app.
  draftCopy: longtext("draft_copy").notNull(),
  // Optional brief for whoever ends up shooting/designing the post (a shot
  // idea, an image description) — not a generation prompt for any specific
  // AI tool, just enough for a human (or the user) to know what to make.
  visualNotes: longtext("visual_notes"),
  researchNoteId: int("research_note_id"), // shared research this was spun from, if any
  /**
   * The analysis this idea was spun out of, if any (PLAN.md §1.3). Points at
   * `analyses.id` rather than `videos.id` on purpose: analyses are append-only
   * and versioned, so the analysis id records exactly which payload — which
   * model, which prompt version — grounded the idea. Sits beside
   * `researchNoteId`: an idea has at most one of the two, never both.
   */
  sourceAnalysisId: int("source_analysis_id"),
  /**
   * Every factual claim the idea rests on (a law, a price, a program name,
   * a statistic), each with the URL(s) it was checked against.
   */
  citations: json("citations").$type<{ claim: string; sources: string[] }[]>(),
  status: varchar("status", { length: 64, ...{ enum: IDEA_STATUSES } })
    .notNull()
    .default("proposed"),
  /**
   * When the idea moved to `posted` (PLAN.md §1.23), so "what went out this
   * week" is a query rather than a guess from `createdAt`. Set by
   * `PATCH /api/ideas/[id]` on the transition in, cleared on the way out — it
   * always describes the current status, never a past one.
   */
  postedAt: datetime("posted_at", { mode: "date", fsp: 3 }),
  createdAt: datetime("created_at", { mode: "date", fsp: 3 })
    .notNull()
    .default(sql`(current_timestamp(3))`),
});

// =============================================================================
// clips — the save-link inbox (PLAN.md §2)
// =============================================================================

export const CLIP_PLATFORMS = ["youtube", "instagram", "facebook", "other"] as const;
export type ClipPlatform = (typeof CLIP_PLATFORMS)[number];

export const CLIP_STATUSES = [
  "unprocessed",
  "ingesting",
  "analyzed",
  "promoted",
  "failed",
] as const;
export type ClipStatus = (typeof CLIP_STATUSES)[number];

/**
 * Why a clip was saved (PLAN.md §1.43–§1.44). Decides what happens to it next:
 * only `fact_check` and `competitor` clips are fetched and transcribed without
 * a click; `inspo` never is.
 */
/** `learn`: an AI tool or lesson to try (build 4, the aiinsights merge). */
export const CLIP_PURPOSES = [
  "inspo",
  "competitor",
  "fact_check",
  "own",
  "learn",
  "other",
] as const;
export type ClipPurpose = (typeof CLIP_PURPOSES)[number];

/** Which door the clip came in through (§1.43). `web` is the in-app form and every row before build 3. */
export const CLIP_SOURCES = ["share", "shortcut", "telegram", "web"] as const;
export type ClipSource = (typeof CLIP_SOURCES)[number];

/** One claim a fetched clip makes, for fact-checking (§1.44). */
export type ClipClaim = { claim: string; timestampSec?: number };

/**
 * One row per link saved from a phone share sheet — the capture half of the
 * app (PLAN.md §1.6). Capture is time-sensitive in a way processing is not: a
 * clip scrolled past and not logged is gone, so a row is written the moment a
 * URL arrives, before anything is known about it.
 *
 * `status` is the pipeline's state machine:
 *   unprocessed — stored, nothing fetched (the resting state for IG/FB)
 *   ingesting   — a YouTube clip handed to the existing ingest path
 *   analyzed    — ingest finished; `videoId` points at the video row
 *   promoted    — turned into an idea; `ideaId` points at it
 *   failed      — ingest or fetch broke; `error` says how, and a retry is manual
 */
export const clips = mysqlTable(
  "clips",
  {
    id: int("id").primaryKey().autoincrement(),
    /** The saved link, verbatim. Unique: re-saving updates the note, never duplicates. */
    url: varchar("url", { length: 1024 }).notNull(),
    /** Full URL identity without a lossy prefix index (utf8mb4 URLs may exceed index limits). */
    urlHash: char("url_hash", { length: 64 }).generatedAlwaysAs(sql`sha2(url, 256)`, {
      mode: "stored",
    }),
    /** Derived from the URL at save time, not asked for — the share sheet sends no fields. */
    platform: varchar("platform", { length: 64, ...{ enum: CLIP_PLATFORMS } })
      .notNull()
      .default("other"),
    /**
     * "Why I saved this", one line, optional. PLAN.md §1.7: metadata fetching
     * is best-effort (Meta gates oEmbed, YouTube blocks datacenter IPs), so the
     * URL plus this note is the guaranteed floor of a clip's usefulness — the
     * one field that never depends on a network call succeeding.
     */
    note: longtext("note"),
    /** Best-effort fetched metadata. Null is normal, not an error state. */
    title: varchar("title", { length: 512 }),
    author: varchar("author", { length: 255 }),
    thumbnailUrl: varchar("thumbnail_url", { length: 1024 }),
    status: varchar("status", { length: 64, ...{ enum: CLIP_STATUSES } })
      .notNull()
      .default("unprocessed"),
    /** Soft link to `videos.id`, set once a YouTube clip has been ingested. */
    videoId: int("video_id"),
    /** Soft link to `ideas.id`, set once the clip has been promoted. */
    ideaId: int("idea_id"),
    /** Why the last attempt failed, for the inbox to show next to a retry. */
    error: varchar("error", { length: 1024 }),
    savedAt: datetime("saved_at", { mode: "date", fsp: 3 })
      .notNull()
      .default(sql`(current_timestamp(3))`),

    // --- build 3 (PLAN.md §2): capture + fetch --------------------------------
    /** Soft link to `brands.id`, from `#<brand>` in a Telegram message or the inbox. */
    brandId: varchar("brand_id", { length: 255 }),
    purpose: varchar("purpose", { length: 64, ...{ enum: CLIP_PURPOSES } })
      .notNull()
      .default("other"),
    /** Free tags (`#tag` in a capture message), lower-case, no `#`. */
    tags: json("tags")
      .$type<string[]>()
      .notNull()
      .default(sql`(json_array())`),
    source: varchar("source", { length: 64, ...{ enum: CLIP_SOURCES } })
      .notNull()
      .default("web"),
    /** The post's own caption / on-screen text, as fetched (§1.44). */
    postText: longtext("post_text"),
    transcript: longtext("transcript"),
    summary: longtext("summary"),
    claims: json("claims").$type<ClipClaim[]>(),
    /** Soft link to `assets.id`: the downloaded media under `captures/<clip-id>/`. */
    mediaAssetId: int("media_asset_id"),
    /** A photo/video sent to the bot as a file; S17 downloads it (Bot API limit 20 MB). */
    telegramFileId: varchar("telegram_file_id", { length: 255 }),
    /** When media fetch + transcript last succeeded. */
    fetchedAt: datetime("fetched_at", { mode: "date", fsp: 3 }),
    /**
     * When the clip last entered `ingesting`. The stuck-ingest reaper keys on
     * this, not on `savedAt`: a retried clip saved weeks ago would otherwise
     * look stuck the moment its retry started. Null on rows from before it.
     */
    ingestStartedAt: datetime("ingest_started_at", { mode: "date", fsp: 3 }),

    // --- build 4: learn (the aiinsights merge, docs/PLAN-build4.md §3.E) ------
    /** One of `LEARN_CATEGORIES` (src/lib/learn), set by the learn summary. */
    learnCategory: varchar("learn_category", { length: 64 }),
    /** "How to start" steps from the learn summary. */
    howToStart: json("how_to_start").$type<string[]>(),
    /** When Anton marked it tried/implemented; null = not yet. */
    implementedAt: datetime("implemented_at", { mode: "date", fsp: 3 }),
    /** When Anton committed to it from the weekly nudge. */
    committedAt: datetime("committed_at", { mode: "date", fsp: 3 }),
  },
  (t) => [
    // Dedupe key: the save route upserts on this rather than checking first.
    uniqueIndex("clips_url_hash_idx").on(t.urlHash),
    // The inbox's two queries: filter by status, order newest-first.
    index("clips_status_idx").on(t.status),
    index("clips_saved_idx").on(t.savedAt),
    // The inbox's build 3 filters, and the fetch job's "eligible clips" scan.
    index("clips_brand_idx").on(t.brandId),
    index("clips_purpose_idx").on(t.purpose),
  ],
);

// =============================================================================
// YouTube research tool — ported from the standalone "yt" repo, converted
// from MySQL (drizzle-orm/mysql-core) to Postgres/Neon (drizzle-orm/pg-core):
//   - mysqlTable -> mysqlTable
//   - int(...).autoincrement().primaryKey() -> int(...).primaryKey().autoincrement()
//   - mysqlEnum(col, [...]) -> text(col, { enum: [...] as const }), matching
//     the convention already used above for `format`/`status`
//   - longtext -> text (Postgres text has no length ceiling)
//   - decimal -> decimal (pg-core's name for the same type)
//   - JSON columns keep the same json(...).$type<T>() shape as the tables above
// Table names and columns are otherwise unchanged from the source schema; see
// PLAN.md §3 in the yt repo for the original rationale behind each field.
// =============================================================================

// ---------------------------------------------------------------------------
// yt_users — owner/employee login (PLAN.md §9 PR-23/24)
// ---------------------------------------------------------------------------

/**
 * Auth for the whole merged app (see src/middleware.ts) — not just the
 * /youtube/* section. Named `yt_users` (not `users`) only to keep the table's
 * origin obvious in the shared schema file; nothing about its columns is
 * YouTube-specific.
 */
export const users = mysqlTable("yt_users", {
  id: int("id").primaryKey().autoincrement(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  /** owner spends money and deletes things; employee does neither. */
  role: varchar("role", { length: 64, ...{ enum: ["owner", "employee"] as const } })
    .notNull()
    .default("employee"),
  /** bcrypt hash, null until a password is set. */
  passwordHash: varchar("password_hash", { length: 255 }),
  createdAt: datetime("created_at", { mode: "date", fsp: 3 })
    .notNull()
    .default(sql`(current_timestamp(3))`),
});

// ---------------------------------------------------------------------------
// sources — tracked channels and playlists
// ---------------------------------------------------------------------------

export const sources = mysqlTable(
  "sources",
  {
    id: int("id").primaryKey().autoincrement(),
    kind: varchar("kind", { length: 64, ...{ enum: ["channel", "playlist"] as const } }).notNull(),
    /** Channel ID (UC…) or playlist ID (PL…, UU…). */
    youtubeId: varchar("youtube_id", { length: 64 }).notNull(),
    title: varchar("title", { length: 512 }).notNull(),
    url: varchar("url", { length: 512 }).notNull(),
    lastPolledAt: datetime("last_polled_at", { mode: "date", fsp: 3 }),
    active: boolean("active").notNull().default(true),
    createdAt: datetime("created_at", { mode: "date", fsp: 3 })
      .notNull()
      .default(sql`(current_timestamp(3))`),
  },
  (t) => [
    uniqueIndex("sources_youtube_id_idx").on(t.youtubeId),
    // The poller's only query: active sources, least recently polled first.
    index("sources_active_polled_idx").on(t.active, t.lastPolledAt),
  ],
);

// ---------------------------------------------------------------------------
// videos
// ---------------------------------------------------------------------------

/**
 * caption_status is the pipeline's state machine (PR-05):
 *   unknown   — not probed yet
 *   available — captions fetched, transcript row exists
 *   none      — the video genuinely has no captions; skipped forever
 *   failed    — probing broke for a reason that may not recur; safe to retry
 */
export const videos = mysqlTable(
  "videos",
  {
    id: int("id").primaryKey().autoincrement(),
    youtubeId: varchar("youtube_id", { length: 16 }).notNull(),
    /** Null for videos added directly by URL rather than discovered via a source. */
    sourceId: int("source_id"),
    title: varchar("title", { length: 512 }).notNull(),
    /** [PR-33] The uploader's description, as written — stored in full. */
    description: longtext("description"),
    channelTitle: varchar("channel_title", { length: 255 }),
    publishedAt: datetime("published_at", { mode: "date", fsp: 3 }),
    durationSeconds: int("duration_seconds"),
    viewCount: bigint("view_count", { mode: "number" }),
    /** [PR-33] Null means the uploader hides the counter, not zero. */
    likeCount: bigint("like_count", { mode: "number" }),
    commentCount: bigint("comment_count", { mode: "number" }),
    thumbnailUrl: varchar("thumbnail_url", { length: 512 }),
    captionStatus: varchar("caption_status", {
      length: 64,
      ...{
        enum: ["unknown", "available", "none", "failed"] as const,
      },
    })
      .notNull()
      .default("unknown"),
    captionCheckedAt: datetime("caption_checked_at", { mode: "date", fsp: 3 }),

    createdAt: datetime("created_at", { mode: "date", fsp: 3 })
      .notNull()
      .default(sql`(current_timestamp(3))`),
  },
  (t) => [
    uniqueIndex("videos_youtube_id_idx").on(t.youtubeId),
    index("videos_source_idx").on(t.sourceId),
    // The feed orders by published_at desc; the backfill scans by caption_status.
    index("videos_published_idx").on(t.publishedAt),
    index("videos_caption_status_idx").on(t.captionStatus),
    // The "added" sort order. Read state lives in video_reads (PR-25).
    index("videos_created_idx").on(t.createdAt),
  ],
);

// ---------------------------------------------------------------------------
// transcripts
// ---------------------------------------------------------------------------

/**
 * `source` records where the text came from. 'ai' exists in the enum but is
 * never written in v1 — audio transcription is a paid-tier feature.
 */
export const transcripts = mysqlTable(
  "transcripts",
  {
    id: int("id").primaryKey().autoincrement(),
    videoId: int("video_id").notNull(),
    language: varchar("language", { length: 16 }),
    source: varchar("source", { length: 64, ...{ enum: ["captions", "manual", "ai"] as const } })
      .notNull()
      .default("captions"),
    wordCount: int("word_count").notNull().default(0),
    content: longtext("content").notNull(),
    fetchedAt: datetime("fetched_at", { mode: "date", fsp: 3 })
      .notNull()
      .default(sql`(current_timestamp(3))`),
  },
  (t) => [uniqueIndex("transcripts_video_id_idx").on(t.videoId)],
);

// ---------------------------------------------------------------------------
// analyses
// ---------------------------------------------------------------------------

/**
 * One row per analysis run. Analyses are never overwritten — re-analysing
 * with a different model or prompt_version inserts a new row.
 */
export const analyses = mysqlTable(
  "analyses",
  {
    id: int("id").primaryKey().autoincrement(),
    videoId: int("video_id").notNull(),
    model: varchar("model", { length: 64 }).notNull(),
    promptVersion: smallint("prompt_version").notNull().default(1),

    status: varchar("status", { length: 64, ...{ enum: ["ok", "failed"] as const } })
      .notNull()
      .default("ok"),

    summary: longtext("summary"),
    takeaways: json("takeaways").$type<string[]>(),
    hookBreakdown: json("hook_breakdown").$type<AnalysisHook>(),
    timeline: json("timeline").$type<AnalysisTimelineEntry[]>(),
    gaps: json("gaps").$type<AnalysisGap[]>(),
    ideas: json("ideas").$type<AnalysisIdea[]>(),

    /**
     * [PR-34] The payload's own immutable copy of the grouping fields — see
     * the comment on `topics`/`video_topics` below for why this is not
     * redundant with the lookup tables. Null on a version-1 row.
     */
    topics: json("topics").$type<string[]>(),
    entities: json("entities").$type<string[]>(),
    contentType: varchar("content_type", { length: 64 }),

    /** Store raw response on parse failure rather than crashing the batch. */
    rawResponse: longtext("raw_response"),
    error: varchar("error", { length: 1024 }),

    /** Batch API request id (PR-07), null for interactive runs. */
    batchId: varchar("batch_id", { length: 128 }),

    inputTokens: int("input_tokens").notNull().default(0),
    outputTokens: int("output_tokens").notNull().default(0),
    cacheReadTokens: int("cache_read_tokens").notNull().default(0),
    cacheWriteTokens: int("cache_write_tokens").notNull().default(0),

    costUsd: decimal("cost_usd", { precision: 10, scale: 6 }).notNull().default("0"),
    createdAt: datetime("created_at", { mode: "date", fsp: 3 })
      .notNull()
      .default(sql`(current_timestamp(3))`),
  },
  (t) => [
    index("analyses_video_idx").on(t.videoId),
    uniqueIndex("analyses_batch_video_idx").on(t.batchId, t.videoId),
    index("analyses_status_idx").on(t.status),
    index("analyses_batch_idx").on(t.batchId),
  ],
);

// ---------------------------------------------------------------------------
// batches
// ---------------------------------------------------------------------------

/**
 * One row per submitted Batch API job (PR-15) — this app's own ledger for a
 * job's lifecycle, since walking the provider's `batches.list()` has a
 * 24-hour horizon and includes every other project on the same API key.
 *
 * `status`:
 *   in_progress — submitted, results not ready
 *   ended       — provider finished it, we have not written the rows yet
 *   collected   — rows are in `analyses`; never looked at again
 *   canceled    — terminal, nothing to collect
 */
export const batches = mysqlTable(
  "batches",
  {
    id: int("id").primaryKey().autoincrement(),
    /** The provider's batch id (`msgbatch_…`). */
    providerBatchId: varchar("provider_batch_id", { length: 128 }).notNull(),
    status: varchar("status", {
      length: 64,
      ...{
        enum: ["in_progress", "ended", "collected", "canceled", "uncertain"] as const,
      },
    })
      .notNull()
      .default("in_progress"),
    model: varchar("model", { length: 64 }).notNull(),
    videoCount: int("video_count").notNull().default(0),
    estimatedUsd: decimal("estimated_usd", { precision: 10, scale: 6 }).notNull().default("0"),
    submittedAt: datetime("submitted_at", { mode: "date", fsp: 3 })
      .notNull()
      .default(sql`(current_timestamp(3))`),
    collectedAt: datetime("collected_at", { mode: "date", fsp: 3 }),
  },
  (t) => [
    uniqueIndex("batches_provider_id_idx").on(t.providerBatchId),
    index("batches_status_idx").on(t.status),
  ],
);

// ---------------------------------------------------------------------------
// outlines
// ---------------------------------------------------------------------------

/**
 * Generated on demand from one idea in an analysis, so the five-part outline
 * never inflates the per-video analysis cost. idea_index points into
 * `analyses.ideas`.
 */
export const outlines = mysqlTable(
  "outlines",
  {
    id: int("id").primaryKey().autoincrement(),
    analysisId: int("analysis_id").notNull(),
    ideaIndex: smallint("idea_index").notNull(),

    status: varchar("status", { length: 64, ...{ enum: ["ok", "failed"] as const } })
      .notNull()
      .default("ok"),
    error: varchar("error", { length: 1024 }),

    content: json("content").$type<OutlinePayload>(),
    rawResponse: longtext("raw_response"),
    model: varchar("model", { length: 64 }),
    costUsd: decimal("cost_usd", { precision: 10, scale: 6 }).notNull().default("0"),
    createdAt: datetime("created_at", { mode: "date", fsp: 3 })
      .notNull()
      .default(sql`(current_timestamp(3))`),
  },
  (t) => [
    // One outline per idea — regenerating replaces rather than accumulates.
    uniqueIndex("outlines_analysis_idea_idx").on(t.analysisId, t.ideaIndex),
  ],
);

// ---------------------------------------------------------------------------
// screenings
// ---------------------------------------------------------------------------

/**
 * [PR-35] Gallringen, step 1 — a metadata-only screening that decides whether
 * a video is worth a full ($0.02) analysis. Stores a score, not a verdict
 * (the bar, SCREEN_MIN_SCORE, is a spend dial that moves); not append-only
 * (a screening is a disposable opinion, one current row per video).
 */
export const screenings = mysqlTable(
  "screenings",
  {
    id: int("id").primaryKey().autoincrement(),
    videoId: int("video_id").notNull(),
    status: varchar("status", { length: 64, ...{ enum: ["ok", "failed"] as const } })
      .notNull()
      .default("ok"),
    /** 0–100, how well the metadata says this video is worth reading. Null on a failed row. */
    score: smallint("score"),
    /** One sentence, in the model's words, for why. Shown in the UI verbatim. */
    reason: varchar("reason", { length: 512 }),
    model: varchar("model", { length: 64 }).notNull(),
    promptVersion: smallint("prompt_version").notNull().default(1),
    error: varchar("error", { length: 1024 }),
    rawResponse: longtext("raw_response"),
    inputTokens: int("input_tokens").notNull().default(0),
    outputTokens: int("output_tokens").notNull().default(0),
    costUsd: decimal("cost_usd", { precision: 10, scale: 6 }).notNull().default("0"),
    createdAt: datetime("created_at", { mode: "date", fsp: 3 })
      .notNull()
      .default(sql`(current_timestamp(3))`),
  },
  (t) => [
    // One current screening per video — recordScreening's upsert depends on this.
    uniqueIndex("screenings_video_id_idx").on(t.videoId),
    index("screenings_score_idx").on(t.score),
  ],
);

// ---------------------------------------------------------------------------
// topics / video_topics, entities / video_entities
// ---------------------------------------------------------------------------

/**
 * The cross-corpus grouping index (PLAN.md §7). No topic is hardcoded
 * anywhere — the corpus says what it is about. `slug` is the match key,
 * `name` the display form (see slugifyTag in lib/tags.ts).
 */
export const topics = mysqlTable(
  "topics",
  {
    id: int("id").primaryKey().autoincrement(),
    name: varchar("name", { length: 128 }).notNull(),
    slug: varchar("slug", { length: 128 }).notNull(),
  },
  (t) => [uniqueIndex("topics_slug_idx").on(t.slug)],
);

export const videoTopics = mysqlTable(
  "video_topics",
  {
    videoId: int("video_id").notNull(),
    topicId: int("topic_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.videoId, t.topicId] }),
    index("video_topics_topic_idx").on(t.topicId),
  ],
);

/** Named things a video discusses — tools, products, companies, people. */
export const entities = mysqlTable(
  "entities",
  {
    id: int("id").primaryKey().autoincrement(),
    name: varchar("name", { length: 128 }).notNull(),
    slug: varchar("slug", { length: 128 }).notNull(),
  },
  (t) => [uniqueIndex("entities_slug_idx").on(t.slug)],
);

export const videoEntities = mysqlTable(
  "video_entities",
  {
    videoId: int("video_id").notNull(),
    entityId: int("entity_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.videoId, t.entityId] }),
    index("video_entities_entity_idx").on(t.entityId),
  ],
);

// ---------------------------------------------------------------------------
// video_reads
// ---------------------------------------------------------------------------

/**
 * [PR-25] Read state, per user. A row exists only once a user has read or
 * pinned the video — absence means "unread and unpinned". read_at is set
 * once, on first open.
 */
export const videoReads = mysqlTable(
  "video_reads",
  {
    videoId: int("video_id").notNull(),
    userId: int("user_id").notNull(),
    readAt: datetime("read_at", { mode: "date", fsp: 3 }),
    pinned: boolean("pinned").notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.videoId, t.userId] }),
    index("video_reads_user_read_idx").on(t.userId, t.readAt),
    index("video_reads_user_pinned_idx").on(t.userId, t.pinned),
  ],
);

// ---------------------------------------------------------------------------
// video_unit_marks
// ---------------------------------------------------------------------------

/**
 * [PR-37] "This bit was interesting" — at the level of one takeaway, one
 * idea, one timeline beat, rather than one video. `unit_text` is a snapshot:
 * re-analysing a video can reword or drop the unit a mark pointed at, and the
 * snapshot is what survives that.
 */
export const videoUnitMarks = mysqlTable(
  "video_unit_marks",
  {
    videoId: int("video_id").notNull(),
    userId: int("user_id").notNull(),
    /** Mirrors UnitType in lib/listen/units.ts. The two must not drift. */
    unitType: varchar("unit_type", {
      length: 64,
      ...{
        enum: ["summary", "takeaway", "hook", "timeline", "gap", "idea"] as const,
      },
    }).notNull(),
    unitIndex: int("unit_index").notNull(),
    /** What was marked, as it read at the time. Truncated on write, not rejected. */
    unitText: varchar("unit_text", { length: 1024 }).notNull(),
    createdAt: datetime("created_at", { mode: "date", fsp: 3 })
      .notNull()
      .default(sql`(current_timestamp(3))`),
  },
  (t) => [
    primaryKey({ columns: [t.videoId, t.userId, t.unitType, t.unitIndex] }),
    index("video_unit_marks_user_created_idx").on(t.userId, t.createdAt),
  ],
);

// ---------------------------------------------------------------------------
// spend_log
// ---------------------------------------------------------------------------

/**
 * One row per UTC day, incremented as analyses complete. Drives the header
 * counter and the hard monthly cap (PR-07).
 */
export const spendLog = mysqlTable(
  "spend_log",
  {
    id: int("id").primaryKey().autoincrement(),
    /** UTC calendar day. */
    day: date("day", { mode: "string" }).notNull(),
    costUsd: decimal("cost_usd", { precision: 10, scale: 6 }).notNull().default("0"),
  },
  (t) => [uniqueIndex("spend_log_day_idx").on(t.day)],
);

// ---------------------------------------------------------------------------
// spend_reservation
// ---------------------------------------------------------------------------

/**
 * Single-row table (id always 1) holding in-flight spend not yet in `spend_log`
 * or `batches`. Closes the gap between "checked the cap" and "billed for it":
 * two concurrent analyses can each read the same spend_log/batches totals and
 * both pass the check before either's bill lands. Reserving here first forces
 * them to serialize on this row's write lock — see spend.ts's withSpendCap.
 */
export const spendReservation = mysqlTable("spend_reservation", {
  id: int("id").primaryKey(),
  reservedUsd: decimal("reserved_usd", { precision: 10, scale: 6 }).notNull().default("0"),
});

/** Per-attempt holds survive a process crash and can be reconciled without resetting the cap. */
export const spendHolds = mysqlTable("spend_holds", {
  id: varchar("id", { length: 36 }).primaryKey(),
  owner: varchar("owner", { length: 255 }).notNull(),
  estimatedUsd: decimal("estimated_usd", { precision: 10, scale: 6 }).notNull(),
  status: varchar("status", {
    length: 64,
    ...{ enum: ["held", "released", "uncertain", "reconciled"] },
  })
    .notNull()
    .default("held"),
  expiresAt: datetime("expires_at", { mode: "date", fsp: 3 }).notNull(),
  accountedDay: date("accounted_day", { mode: "string" }),
  actualUsd: decimal("actual_usd", { precision: 10, scale: 6 }),
  settledUsd: decimal("settled_usd", { precision: 10, scale: 6 }).notNull().default("0"),
  uncertainUsd: decimal("uncertain_usd", { precision: 10, scale: 6 }),
  recoveryNote: varchar("recovery_note", { length: 1024 }),
  createdAt: datetime("created_at", { mode: "date", fsp: 3 })
    .notNull()
    .default(sql`(current_timestamp(3))`),
  updatedAt: datetime("updated_at", { mode: "date", fsp: 3 })
    .notNull()
    .default(sql`(current_timestamp(3))`),
});

// ---------------------------------------------------------------------------
// leases
// ---------------------------------------------------------------------------

/**
 * Named, expiring locks (PLAN.md §1.19) — one row per job that must never run
 * twice at once. First user: `poll`, taken by both `/api/cron/poll` and
 * `npm run yt:poll`, which used to guard only against themselves with a module
 * variable (two processes each saw their own `false`).
 *
 * A row rather than `pg_advisory_lock` because Neon's HTTP driver runs one
 * statement per request and holds no session to keep an advisory lock on; see
 * src/lib/lease.ts for the single-statement acquire. `expires_at` is what
 * makes a crashed holder harmless: its lease lapses on its own, no cleanup job.
 */
export const leases = mysqlTable("leases", {
  /** The job's name, e.g. "poll". The primary key is the lock. */
  name: varchar("name", { length: 255 }).primaryKey(),
  /** Who holds it — random per acquire, so only the holder can release it. */
  holder: varchar("holder", { length: 255 }).notNull(),
  /** After this, anyone may take the lease over. */
  expiresAt: datetime("expires_at", { mode: "date", fsp: 3 }).notNull(),
});

// =============================================================================
// Research studio (PLAN.md §1.29–§1.32, O7). Competitor links, saved lessons
// and on-camera scripts. Soft links only, like everything above (§1.4).
// =============================================================================

// ---------------------------------------------------------------------------
// brand_sources
// ---------------------------------------------------------------------------

/**
 * `own` (build 2b, idea 4) marks Anton's own channel for a brand, so the
 * compare page can put it next to the competitors with the same outlier math.
 */
export const BRAND_SOURCE_ROLES = ["competitor", "inspiration", "own"] as const;
export type BrandSourceRole = (typeof BRAND_SOURCE_ROLES)[number];

/**
 * Which tracked channels a brand studies (PLAN.md §1.29). A link table rather
 * than a `brand_id` on `sources`, because §1.3 keeps the YouTube half free of
 * brand columns and because one channel can be a competitor for several
 * brands at once — a column would force a channel to pick one.
 */
export const brandSources = mysqlTable(
  "brand_sources",
  {
    /** Soft link to `brands.id` (a slug). */
    brandId: varchar("brand_id", { length: 255 }).notNull(),
    /** Soft link to `sources.id`. The source row is shared; only the link is per brand. */
    sourceId: int("source_id").notNull(),
    /**
     * `competitor` — someone chasing the same audience, studied for what works;
     * `inspiration` — someone outside the niche whose format is worth borrowing.
     * The outlier board can show either, so the distinction is kept, not implied.
     */
    role: varchar("role", { length: 64, ...{ enum: BRAND_SOURCE_ROLES } })
      .notNull()
      .default("competitor"),
    /** When the link was made, so the research page can list newest first. */
    addedAt: datetime("added_at", { mode: "date", fsp: 3 })
      .notNull()
      .default(sql`(current_timestamp(3))`),
  },
  (t) => [
    // One link per pair (§2): re-linking changes the role, never duplicates.
    primaryKey({ columns: [t.brandId, t.sourceId] }),
    // "Which brands study this channel" — the reverse read.
    index("brand_sources_source_idx").on(t.sourceId),
  ],
);

// ---------------------------------------------------------------------------
// lessons
// ---------------------------------------------------------------------------

/** `cta` and `caption_pattern` (build 3, §2) feed post generation and the hooks library. */
export const LESSON_KINDS = [
  "lesson",
  "hook",
  "title_pattern",
  "fact",
  "cta",
  "caption_pattern",
] as const;
export type LessonKind = (typeof LESSON_KINDS)[number];

/**
 * Something worth keeping from a digest (PLAN.md §1.31): a lesson, a hook, a
 * title pattern, a fact. Its own table rather than a flavour of
 * `video_unit_marks`, because a mark is "this bit was interesting" per user
 * and per analysis unit, while a lesson is Anton's own words, may belong to a
 * brand, and outlives any re-analysis. Saved by hand only, never auto-created —
 * a table the model filled would be a second copy of the analyses.
 */
export const lessons = mysqlTable(
  "lessons",
  {
    id: int("id").primaryKey().autoincrement(),
    /** The lesson itself, in whatever words it was saved with. */
    text: longtext("text").notNull(),
    /** What kind of thing it is — decides where the script prompt uses it (hooks vs facts). */
    kind: varchar("kind", { length: 64, ...{ enum: LESSON_KINDS } })
      .notNull()
      .default("lesson"),
    /** Soft link to `brands.id`. Null is a portfolio-wide lesson, not a missing value. */
    brandId: varchar("brand_id", { length: 255 }),
    /** Soft link to `brand_families.id`: a lesson shared by every brand in a family (§2). */
    familyId: varchar("family_id", { length: 255 }),
    /** Soft link to `videos.id` it was learned from, when it came from a video. */
    videoId: int("video_id"),
    /** Where in that video, so the export can link to the exact moment. */
    timestampSec: int("timestamp_sec"),
    /** Provenance outside the corpus (an article, a post). Also the only link when `videoId` is null. */
    sourceUrl: varchar("source_url", { length: 1024 }),
    createdAt: datetime("created_at", { mode: "date", fsp: 3 })
      .notNull()
      .default(sql`(current_timestamp(3))`),
  },
  (t) => [
    // The lessons page and the Markdown export both filter by brand, then kind.
    index("lessons_brand_kind_idx").on(t.brandId, t.kind),
    // The video page's "lessons from this video".
    index("lessons_video_idx").on(t.videoId),
    index("lessons_family_kind_idx").on(t.familyId, t.kind),
  ],
);

// ---------------------------------------------------------------------------
// scripts
// ---------------------------------------------------------------------------

export const SCRIPT_STATUSES = ["draft", "ready", "recorded", "posted"] as const;
export type ScriptStatus = (typeof SCRIPT_STATUSES)[number];

/**
 * An on-camera script (PLAN.md §1.32): what Anton reads from the teleprompter,
 * plus titles, thumbnails, shots and sources. The content lives in `body`; the
 * columns are only what lists and filters need without opening it.
 */
export const scripts = mysqlTable(
  "scripts",
  {
    id: int("id").primaryKey().autoincrement(),
    /** Soft link to `brands.id` — every script is written for one brand's channel. */
    brandId: varchar("brand_id", { length: 255 }).notNull(),
    /** Soft link to `ideas.id` when the script grew out of an idea; most will not. */
    ideaId: int("idea_id"),
    /** The chosen title, copied out of the body so lists never parse JSON. */
    title: longtext("title").notNull(),
    /** Language the script is written in (§1.33: per brand by default, switchable per run). */
    language: varchar("language", { length: 16 }).notNull(),
    /** draft → ready → recorded → posted. Nothing enforces the order; the UI offers it. */
    status: varchar("status", { length: 64, ...{ enum: SCRIPT_STATUSES } })
      .notNull()
      .default("draft"),
    /**
     * The script itself. json, opaque at this layer: the contract (and its
     * `version`) belongs to src/lib/scripts/contract.ts (O8), which videoPY will
     * read too. The bridge refuses a write its validator rejects, so a stored
     * body is always one some contract version accepted.
     */
    body: json("body").notNull(),
    createdAt: datetime("created_at", { mode: "date", fsp: 3 })
      .notNull()
      .default(sql`(current_timestamp(3))`),
    /** Bumped on every body or status write — "recently edited" sorts on it. */
    updatedAt: datetime("updated_at", { mode: "date", fsp: 3 })
      .notNull()
      .default(sql`(current_timestamp(3))`),
    /** When it moved to `recorded` (or straight to `posted`). Cleared if it moves back. */
    recordedAt: datetime("recorded_at", { mode: "date", fsp: 3 }),
    /** When it moved to `posted`. Cleared if it moves back — it describes the current status. */
    postedAt: datetime("posted_at", { mode: "date", fsp: 3 }),
    /** The published video, pasted after upload (idea 6). Feeds the post-recording pack. */
    youtubeUrl: varchar("youtube_url", { length: 512 }),
    /**
     * Description, chapters, tags, pinned comment and social captions generated
     * after recording (idea 6). Shape: `PublishPack` in src/lib/studio/types.ts.
     */
    publishPack: json("publish_pack"),
    /** The thumbnail Anton picked, a path under `media/<id>/thumbnails/` (idea 10). */
    thumbnailFile: varchar("thumbnail_file", { length: 512 }),
    /** Soft link to the long script a short was cut from (idea 7). Null for originals. */
    parentScriptId: int("parent_script_id"),
  },
  (t) => [
    // The studio list: one brand, one status, most recently edited first.
    index("scripts_brand_status_idx").on(t.brandId, t.status),
    index("scripts_updated_idx").on(t.updatedAt),
  ],
);

// ---------------------------------------------------------------------------
// relations
// ---------------------------------------------------------------------------

/**
 * No foreign key constraints are declared. Ingest is idempotent and inherently
 * out of order — a video can arrive before its source row is committed — and a
 * mid-batch FK violation would abort a whole poll run. Referential integrity is
 * enforced by the upsert paths; these relations exist for query ergonomics.
 */

export const sourcesRelations = relations(sources, ({ many }) => ({
  videos: many(videos),
}));

export const videosRelations = relations(videos, ({ one, many }) => ({
  source: one(sources, { fields: [videos.sourceId], references: [sources.id] }),
  transcript: one(transcripts, { fields: [videos.id], references: [transcripts.videoId] }),
  analyses: many(analyses),
  screening: one(screenings, { fields: [videos.id], references: [screenings.videoId] }),
  videoTopics: many(videoTopics),
  reads: many(videoReads),
  unitMarks: many(videoUnitMarks),
}));

export const videoUnitMarksRelations = relations(videoUnitMarks, ({ one }) => ({
  video: one(videos, { fields: [videoUnitMarks.videoId], references: [videos.id] }),
  user: one(users, { fields: [videoUnitMarks.userId], references: [users.id] }),
}));

export const videoReadsRelations = relations(videoReads, ({ one }) => ({
  video: one(videos, { fields: [videoReads.videoId], references: [videos.id] }),
  user: one(users, { fields: [videoReads.userId], references: [users.id] }),
}));

export const transcriptsRelations = relations(transcripts, ({ one }) => ({
  video: one(videos, { fields: [transcripts.videoId], references: [videos.id] }),
}));

export const analysesRelations = relations(analyses, ({ one, many }) => ({
  video: one(videos, { fields: [analyses.videoId], references: [videos.id] }),
  outlines: many(outlines),
}));

export const screeningsRelations = relations(screenings, ({ one }) => ({
  video: one(videos, { fields: [screenings.videoId], references: [videos.id] }),
}));

export const outlinesRelations = relations(outlines, ({ one }) => ({
  analysis: one(analyses, { fields: [outlines.analysisId], references: [analyses.id] }),
}));

export const clipsRelations = relations(clips, ({ one }) => ({
  video: one(videos, { fields: [clips.videoId], references: [videos.id] }),
  idea: one(ideas, { fields: [clips.ideaId], references: [ideas.id] }),
}));

export const ideasRelations = relations(ideas, ({ one }) => ({
  brand: one(brands, { fields: [ideas.brandId], references: [brands.id] }),
  sourceAnalysis: one(analyses, {
    fields: [ideas.sourceAnalysisId],
    references: [analyses.id],
  }),
  researchNote: one(researchNotes, {
    fields: [ideas.researchNoteId],
    references: [researchNotes.id],
  }),
}));

export const brandsRelations = relations(brands, ({ many }) => ({
  ideas: many(ideas),
}));

export const brandSourcesRelations = relations(brandSources, ({ one }) => ({
  brand: one(brands, { fields: [brandSources.brandId], references: [brands.id] }),
  source: one(sources, { fields: [brandSources.sourceId], references: [sources.id] }),
}));

export const lessonsRelations = relations(lessons, ({ one }) => ({
  brand: one(brands, { fields: [lessons.brandId], references: [brands.id] }),
  video: one(videos, { fields: [lessons.videoId], references: [videos.id] }),
}));

export const scriptsRelations = relations(scripts, ({ one }) => ({
  brand: one(brands, { fields: [scripts.brandId], references: [brands.id] }),
  idea: one(ideas, { fields: [scripts.ideaId], references: [ideas.id] }),
}));

export const topicsRelations = relations(topics, ({ many }) => ({
  videoTopics: many(videoTopics),
}));

export const videoTopicsRelations = relations(videoTopics, ({ one }) => ({
  video: one(videos, { fields: [videoTopics.videoId], references: [videos.id] }),
  topic: one(topics, { fields: [videoTopics.topicId], references: [topics.id] }),
}));

// ---------------------------------------------------------------------------
// inferred types — import these rather than redeclaring row shapes in the UI
// ---------------------------------------------------------------------------

export type Brand = typeof brands.$inferSelect;
export type NewBrand = typeof brands.$inferInsert;
export type Idea = typeof ideas.$inferSelect;
export type NewIdea = typeof ideas.$inferInsert;
export type ResearchNote = typeof researchNotes.$inferSelect;
export type NewResearchNote = typeof researchNotes.$inferInsert;
export type Clip = typeof clips.$inferSelect;
export type NewClip = typeof clips.$inferInsert;
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Source = typeof sources.$inferSelect;
export type NewSource = typeof sources.$inferInsert;
export type Video = typeof videos.$inferSelect;
export type NewVideo = typeof videos.$inferInsert;
export type VideoRead = typeof videoReads.$inferSelect;
export type NewVideoRead = typeof videoReads.$inferInsert;
export type VideoUnitMark = typeof videoUnitMarks.$inferSelect;
export type NewVideoUnitMark = typeof videoUnitMarks.$inferInsert;
export type Transcript = typeof transcripts.$inferSelect;
export type NewTranscript = typeof transcripts.$inferInsert;
export type Analysis = typeof analyses.$inferSelect;
export type NewAnalysis = typeof analyses.$inferInsert;
export type Outline = typeof outlines.$inferSelect;
export type Screening = typeof screenings.$inferSelect;
export type NewScreening = typeof screenings.$inferInsert;
export type NewOutline = typeof outlines.$inferInsert;
export type Topic = typeof topics.$inferSelect;
export type NewTopic = typeof topics.$inferInsert;
export type SpendLogRow = typeof spendLog.$inferSelect;
export type Batch = typeof batches.$inferSelect;
export type NewBatch = typeof batches.$inferInsert;

export type BrandSource = typeof brandSources.$inferSelect;
export type NewBrandSource = typeof brandSources.$inferInsert;
export type Lesson = typeof lessons.$inferSelect;
export type NewLesson = typeof lessons.$inferInsert;
export type Script = typeof scripts.$inferSelect;
export type NewScript = typeof scripts.$inferInsert;

export type CaptionStatus = Video["captionStatus"];
export type BatchStatus = Batch["status"];
export type SourceKind = Source["kind"];

// =============================================================================
// Build 2b — studio extras (ideas 1–8, 10). Soft links only (§1.4).
// =============================================================================

/**
 * Weekly competitor report (idea 1): what took off among a brand's
 * competitors in a window, why, and ideas for Anton. Body shape:
 * `CompetitorReport` in src/lib/studio/types.ts.
 */
export const competitorReports = mysqlTable(
  "competitor_reports",
  {
    id: int("id").primaryKey().autoincrement(),
    brandId: varchar("brand_id", { length: 255 }).notNull(),
    /** Length of the window the report looked at, in days. */
    periodDays: int("period_days").notNull(),
    body: json("body").notNull(),
    /** What the report cost through the API; 0 in subscription mode (§1.38). */
    costUsd: decimal("cost_usd", { precision: 10, scale: 6 }).notNull().default("0"),
    createdAt: datetime("created_at", { mode: "date", fsp: 3 })
      .notNull()
      .default(sql`(current_timestamp(3))`),
  },
  (t) => [index("competitor_reports_brand_idx").on(t.brandId, t.createdAt)],
);

export const AUDIENCE_QUESTION_STATUSES = ["new", "used", "dismissed"] as const;
export type AudienceQuestionStatus = (typeof AUDIENCE_QUESTION_STATUSES)[number];

/**
 * Comment mining (idea 2): a question double viewers ask under competitor
 * videos, clustered, with how often it came up. A cluster is a topic with
 * proven demand.
 */
export const audienceQuestions = mysqlTable(
  "audience_questions",
  {
    id: int("id").primaryKey().autoincrement(),
    brandId: varchar("brand_id", { length: 255 }).notNull(),
    /** The question in one clean sentence, in the audience's language. */
    question: longtext("question").notNull(),
    /** How many comments asked it, across the mined videos. */
    askCount: int("ask_count").notNull().default(1),
    /** Up to five verbatim comments, so the wording can be reused. */
    examples: json("examples")
      .$type<string[]>()
      .notNull()
      .default(sql`(json_array())`),
    /** Soft links to `videos.id` the comments came from. */
    videoIds: json("video_ids")
      .$type<number[]>()
      .notNull()
      .default(sql`(json_array())`),
    status: varchar("status", { length: 64, ...{ enum: AUDIENCE_QUESTION_STATUSES } })
      .notNull()
      .default("new"),
    createdAt: datetime("created_at", { mode: "date", fsp: 3 })
      .notNull()
      .default(sql`(current_timestamp(3))`),
  },
  (t) => [index("audience_questions_brand_idx").on(t.brandId, t.status)],
);

/**
 * Fact sheet (idea 3): one checked fact with its source and the date it was
 * last checked. Scripts are given a brand's facts; a fact updated after a
 * script was posted flags that script as possibly out of date.
 */
export const facts = mysqlTable(
  "facts",
  {
    id: int("id").primaryKey().autoincrement(),
    /**
     * Soft link to `brands.id`. Nullable since build 3 (§1.48): a fact that
     * belongs to a whole family (`familyId`) has no one brand.
     */
    brandId: varchar("brand_id", { length: 255 }),
    /** Soft link to `brand_families.id`, for facts shared across a family. */
    familyId: varchar("family_id", { length: 255 }),
    /** The fact's key in an imported source (e.g. `investorVisaMinimum`); null for hand-made facts. */
    externalKey: varchar("external_key", { length: 255 }),
    /** Language the claim is written in. One imported key has a row per locale. */
    language: varchar("language", { length: 8 }).notNull().default("en"),
    /** False: the claim is hedged wording, and generation may only cite it as hedged (§1.48). */
    verified: boolean("verified").notNull().default(false),
    /** Grouping on the fact sheet, e.g. "permanent residency", "closing costs". */
    topic: longtext("topic").notNull(),
    /** The claim as it may be said on camera. */
    claim: longtext("claim").notNull(),
    sourceUrl: varchar("source_url", { length: 1024 }),
    lastCheckedAt: datetime("last_checked_at", { mode: "date", fsp: 3 })
      .notNull()
      .default(sql`(current_timestamp(3))`),
    notes: longtext("notes"),
    createdAt: datetime("created_at", { mode: "date", fsp: 3 })
      .notNull()
      .default(sql`(current_timestamp(3))`),
    /** Bumped when the claim or source changes — what the out-of-date check compares. */
    updatedAt: datetime("updated_at", { mode: "date", fsp: 3 })
      .notNull()
      .default(sql`(current_timestamp(3))`),
  },
  (t) => [
    index("facts_brand_topic_idx").on(t.brandId, t.topic),
    index("facts_family_topic_idx").on(t.familyId, t.topic),
    // The import's upsert key (§1.48). Partial: hand-made facts have no key.
    uniqueIndex("facts_family_key_language_idx").on(t.familyId, t.externalKey, t.language),
  ],
);

export const SCRIPT_DERIVATIVE_KINDS = ["blog", "newsletter"] as const;
export type ScriptDerivativeKind = (typeof SCRIPT_DERIVATIVE_KINDS)[number];

/**
 * Repurposed text made from a script (idea 7). Shorts become their own
 * `scripts` rows (with `parent_script_id`); prose lands here.
 */
export const scriptDerivatives = mysqlTable(
  "script_derivatives",
  {
    id: int("id").primaryKey().autoincrement(),
    scriptId: int("script_id").notNull(),
    kind: varchar("kind", { length: 64, ...{ enum: SCRIPT_DERIVATIVE_KINDS } }).notNull(),
    /** Markdown. */
    content: longtext("content").notNull(),
    createdAt: datetime("created_at", { mode: "date", fsp: 3 })
      .notNull()
      .default(sql`(current_timestamp(3))`),
  },
  (t) => [index("script_derivatives_script_idx").on(t.scriptId)],
);

export type CompetitorReportRow = typeof competitorReports.$inferSelect;
export type AudienceQuestion = typeof audienceQuestions.$inferSelect;
export type Fact = typeof facts.$inferSelect;
export type ScriptDerivative = typeof scriptDerivatives.$inferSelect;

// =============================================================================
// Build 3 — the social OS (PLAN.md §2, O9). Family → Brand → Account → Post →
// Assets (§1.40). This block is the complete contract for build 3: lane 2 and
// lane 3 never add a column (§4.7). Soft links only, no FK constraints (§1.4).
// =============================================================================

/** Every platform an account, a competitor or a post can live on. */
export const SOCIAL_PLATFORMS = [
  "instagram",
  "facebook",
  "tiktok",
  "youtube",
  "threads",
  "x",
  "linkedin",
  "pinterest",
] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

// ---------------------------------------------------------------------------
// brand_families
// ---------------------------------------------------------------------------

/**
 * A group of brands that share facts, research and inspiration (§1.40) — e.g.
 * the Paraguay residency brands, one per language or angle. Nothing in code
 * knows any family by name; behaviour comes from these rows.
 */
export const brandFamilies = mysqlTable("brand_families", {
  /** Slug, e.g. "paraguay-residency". */
  id: varchar("id", { length: 255 }).primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  notes: longtext("notes"),
  createdAt: datetime("created_at", { mode: "date", fsp: 3 })
    .notNull()
    .default(sql`(current_timestamp(3))`),
});

// ---------------------------------------------------------------------------
// brand_kits
// ---------------------------------------------------------------------------

export type KitColor = { name: string; hex: string };
export type KitFont = { role: string; family: string };
/** Higgsfield references every generation for the brand reuses (§1.45). */
export type KitHiggsfield = { elementIds: string[]; characterIds: string[]; styleNotes: string };

/** One per brand: what every visual and caption for it must look and sound like. */
export const brandKits = mysqlTable("brand_kits", {
  /** Soft link to `brands.id`; also the key, so a brand has at most one kit. */
  brandId: varchar("brand_id", { length: 255 }).primaryKey(),
  colors: json("colors")
    .$type<KitColor[]>()
    .notNull()
    .default(sql`(json_array())`),
  fonts: json("fonts")
    .$type<KitFont[]>()
    .notNull()
    .default(sql`(json_array())`),
  /** Soft link to `assets.id`. */
  logoAssetId: int("logo_asset_id"),
  higgsfield: json("higgsfield")
    .$type<KitHiggsfield>()
    .notNull()
    .default({ elementIds: [], characterIds: [], styleNotes: "" }),
  ctas: json("ctas")
    .$type<string[]>()
    .notNull()
    .default(sql`(json_array())`),
  hashtags: json("hashtags")
    .$type<string[]>()
    .notNull()
    .default(sql`(json_array())`),
  dos: longtext("dos"),
  donts: longtext("donts"),
  /** Build 4 (§3.G): where post CTAs send people (a site or VenderCRM form); UTMs are added per post. */
  leadBaseUrl: varchar("lead_base_url", { length: 1024 }),
  updatedAt: datetime("updated_at", { mode: "date", fsp: 3 })
    .notNull()
    .default(sql`(current_timestamp(3))`),
});

// ---------------------------------------------------------------------------
// social_accounts
// ---------------------------------------------------------------------------

export const ACCOUNT_STATUSES = ["planned", "active", "paused"] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

/** One handle on one platform in one language (§1.40). Posts belong to an account. */
export const socialAccounts = mysqlTable(
  "social_accounts",
  {
    id: int("id").primaryKey().autoincrement(),
    /** Soft link to `brands.id`. */
    brandId: varchar("brand_id", { length: 255 }).notNull(),
    platform: varchar("platform", { length: 64, ...{ enum: SOCIAL_PLATFORMS } }).notNull(),
    /** Without the `@`. */
    handle: varchar("handle", { length: 255 }).notNull(),
    /** Null means the brand's language. */
    language: varchar("language", { length: 8 }),
    status: varchar("status", { length: 64, ...{ enum: ACCOUNT_STATUSES } })
      .notNull()
      .default("planned"),
    /** Business/Creator on Instagram — required for insights and publishing (§1.49). */
    isProfessional: boolean("is_professional").notNull().default(false),
    /** The platform's own id: IG user id, FB page id. Set by the Meta link (O12). */
    externalId: varchar("external_id", { length: 128 }),
    /** Soft link to `integrations.id` whose token acts for this account. */
    integrationId: int("integration_id"),
    notes: longtext("notes"),
    createdAt: datetime("created_at", { mode: "date", fsp: 3 })
      .notNull()
      .default(sql`(current_timestamp(3))`),
  },
  (t) => [
    uniqueIndex("social_accounts_platform_handle_idx").on(t.platform, t.handle),
    index("social_accounts_brand_idx").on(t.brandId),
  ],
);

// ---------------------------------------------------------------------------
// integrations
// ---------------------------------------------------------------------------

export const INTEGRATION_PROVIDERS = [
  "meta",
  "tiktok",
  "google_drive",
  "telegram",
  "youtube",
] as const;
export type IntegrationProvider = (typeof INTEGRATION_PROVIDERS)[number];
export const INTEGRATION_STATUSES = ["ok", "expired", "error", "disabled"] as const;
export type IntegrationStatus = (typeof INTEGRATION_STATUSES)[number];

/**
 * A connection to an outside service and its token. The token is only ever
 * stored encrypted (AES-256-GCM with `ENCRYPTION_KEY`, §1.50, O12).
 */
export const integrations = mysqlTable(
  "integrations",
  {
    id: int("id").primaryKey().autoincrement(),
    provider: varchar("provider", { length: 64, ...{ enum: INTEGRATION_PROVIDERS } }).notNull(),
    /** What the settings page calls it, e.g. "Meta — Anton". */
    label: varchar("label", { length: 255 }).notNull(),
    /** Whose token it is on the provider's side: a user id, a page id. */
    accountRef: varchar("account_ref", { length: 255 }),
    tokenCiphertext: longtext("token_ciphertext"),
    /** Monotonic fencing generation for requests using an older credential. */
    credentialVersion: int("credential_version").notNull().default(0),
    tokenExpiresAt: datetime("token_expires_at", { mode: "date", fsp: 3 }),
    scopes: json("scopes")
      .$type<string[]>()
      .notNull()
      .default(sql`(json_array())`),
    status: varchar("status", { length: 64, ...{ enum: INTEGRATION_STATUSES } })
      .notNull()
      .default("ok"),
    lastError: varchar("last_error", { length: 1024 }),
    createdAt: datetime("created_at", { mode: "date", fsp: 3 })
      .notNull()
      .default(sql`(current_timestamp(3))`),
    updatedAt: datetime("updated_at", { mode: "date", fsp: 3 })
      .notNull()
      .default(sql`(current_timestamp(3))`),
  },
  (t) => [
    index("integrations_provider_idx").on(t.provider, t.status),
    uniqueIndex("integrations_provider_account_idx").on(t.provider, t.accountRef),
  ],
);

// ---------------------------------------------------------------------------
// assets — the media library
// ---------------------------------------------------------------------------

export const ASSET_KINDS = ["image", "video", "audio", "document"] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];
export const ASSET_SOURCES = [
  "higgsfield",
  "upload",
  "capture",
  "telegram",
  "import",
  "camera",
] as const;
export type AssetSource = (typeof ASSET_SOURCES)[number];
export const ASSET_STATUSES = ["new", "approved", "rejected", "used", "archived"] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

/**
 * One file in the media library (§1.41). The bytes live on disk under
 * `MEDIA_ROOT` (and, while a post needs it public, on the Hostinger media
 * endpoint); this row holds only text and links. `sha256` is the identity:
 * registering the same file twice is a no-op, wherever it sits.
 */
export const assets = mysqlTable(
  "assets",
  {
    id: int("id").primaryKey().autoincrement(),
    /** Soft link to `brands.id`; null while unsorted. */
    brandId: varchar("brand_id", { length: 255 }),
    /** Soft link to `social_accounts.id`. */
    accountId: int("account_id"),
    kind: varchar("kind", { length: 64, ...{ enum: ASSET_KINDS } }).notNull(),
    mime: varchar("mime", { length: 128 }).notNull(),
    bytes: bigint("bytes", { mode: "number" }).notNull(),
    sha256: char("sha256", { length: 64 }).notNull(),
    width: int("width"),
    height: int("height"),
    durationSec: double("duration_sec"),
    /** Relative to `MEDIA_ROOT`, forward slashes (§1.41 folder layout). */
    localPath: varchar("local_path", { length: 1024 }),
    /** The public Hostinger copy, while one exists. */
    publicUrl: varchar("public_url", { length: 1024 }),
    /** When `prunePublic()` may delete the public copy. */
    publicExpiresAt: datetime("public_expires_at", { mode: "date", fsp: 3 }),
    driveFileId: varchar("drive_file_id", { length: 255 }),
    /** Relative to `MEDIA_ROOT`. */
    thumbPath: varchar("thumb_path", { length: 1024 }),
    source: varchar("source", { length: 64, ...{ enum: ASSET_SOURCES } }).notNull(),
    /** Higgsfield job id or URL, clip id — whatever says where it came from. */
    sourceRef: varchar("source_ref", { length: 1024 }),
    prompt: longtext("prompt"),
    model: varchar("model", { length: 128 }),
    tags: json("tags")
      .$type<string[]>()
      .notNull()
      .default(sql`(json_array())`),
    status: varchar("status", { length: 64, ...{ enum: ASSET_STATUSES } })
      .notNull()
      .default("new"),
    altText: longtext("alt_text"),
    notes: longtext("notes"),
    createdAt: datetime("created_at", { mode: "date", fsp: 3 })
      .notNull()
      .default(sql`(current_timestamp(3))`),
    updatedAt: datetime("updated_at", { mode: "date", fsp: 3 })
      .notNull()
      .default(sql`(current_timestamp(3))`),
  },
  (t) => [
    uniqueIndex("assets_sha256_idx").on(t.sha256),
    index("assets_brand_status_idx").on(t.brandId, t.status),
    index("assets_created_idx").on(t.createdAt),
    index("assets_account_idx").on(t.accountId),
  ],
);

// ---------------------------------------------------------------------------
// posts
// ---------------------------------------------------------------------------

export const POST_FORMATS = ["reel", "carousel", "image_post", "story", "video", "text"] as const;
export type PostFormat = (typeof POST_FORMATS)[number];
export const POST_STATUSES = [
  "idea",
  "drafting",
  "ready",
  "scheduled",
  "publishing",
  "published",
  "failed",
  "archived",
] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

/**
 * One post on one account (§1.40). The content is `body`, a `PostDraft`
 * (src/lib/posts/contract.ts); `caption` and `first_comment` are what actually
 * goes out, copied out of the body and editable on their own.
 */
export const posts = mysqlTable(
  "posts",
  {
    id: int("id").primaryKey().autoincrement(),
    /** Soft link to `social_accounts.id`. */
    accountId: int("account_id").notNull(),
    /** Soft link to `brands.id` — the account's brand, denormalised for filters. */
    brandId: varchar("brand_id", { length: 255 }).notNull(),
    /** Soft link to `ideas.id` the post grew from, if any. */
    ideaId: int("idea_id"),
    /** Soft link to the post this one was adapted from (§1.47). */
    parentPostId: int("parent_post_id"),
    format: varchar("format", { length: 64, ...{ enum: POST_FORMATS } }).notNull(),
    status: varchar("status", { length: 64, ...{ enum: POST_STATUSES } })
      .notNull()
      .default("idea"),
    /** Internal name for lists; never published. */
    title: longtext("title").notNull().default(""),
    /** `PostDraft`; null until the first draft exists. */
    body: json("body"),
    caption: longtext("caption"),
    firstComment: longtext("first_comment"),
    notes: longtext("notes"),
    scheduledFor: datetime("scheduled_for", { mode: "date", fsp: 3 }),
    publishedAt: datetime("published_at", { mode: "date", fsp: 3 }),
    permalink: varchar("permalink", { length: 1024 }),
    /** The platform's media id once published (IG media id, FB post id). */
    externalMediaId: varchar("external_media_id", { length: 128 }),
    /** A created-but-unpublished container (IG reels are polled until ready, O13). */
    externalContainerId: varchar("external_container_id", { length: 128 }),
    publishError: varchar("publish_error", { length: 1024 }),
    publishAttempts: int("publish_attempts").notNull().default(0),
    /** Optimistic edit revision and durable publication authorization/attempt fence. */
    revision: int("revision").notNull().default(0),
    publishAttemptId: varchar("publish_attempt_id", { length: 36 }),
    publishState: varchar("publish_state", {
      length: 64,
      ...{ enum: ["idle", "sending", "ambiguous", "confirmed"] },
    })
      .notNull()
      .default("idle"),
    publishTarget: json("publish_target").$type<import("@/lib/publish/safety").TargetSnapshot>(),
    publishApprovedRevision: int("publish_approved_revision"),
    publishApprovedBy: int("publish_approved_by"),
    publishApprovedAt: datetime("publish_approved_at", { mode: "date", fsp: 3 }),
    publishStartedAt: datetime("publish_started_at", { mode: "date", fsp: 3 }),
    /** Signed upload session is durable so a restart never starts another TikTok upload. */
    publishUpload: json("publish_upload").$type<import("@/lib/publish/tiktok").TikTokUpload>(),
    /** When the last publish attempt started — what the retry backoff counts from. */
    lastPublishAttemptAt: datetime("last_publish_attempt_at", { mode: "date", fsp: 3 }),
    /** Build 4 (§3.G): the CTA link with UTMs, built from the kit's `leadBaseUrl`. */
    leadUrl: varchar("lead_url", { length: 1024 }),
    /** Build 4 (§3.F): platform options, e.g. YouTube privacy/category, TikTok privacy. */
    publishOptions: json("publish_options").$type<Record<string, unknown>>(),
    createdAt: datetime("created_at", { mode: "date", fsp: 3 })
      .notNull()
      .default(sql`(current_timestamp(3))`),
    updatedAt: datetime("updated_at", { mode: "date", fsp: 3 })
      .notNull()
      .default(sql`(current_timestamp(3))`),
  },
  (t) => [
    index("posts_account_status_idx").on(t.accountId, t.status),
    index("posts_scheduled_idx").on(t.scheduledFor),
    index("posts_brand_status_idx").on(t.brandId, t.status),
    index("posts_parent_idx").on(t.parentPostId),
  ],
);

// ---------------------------------------------------------------------------
// post_assets
// ---------------------------------------------------------------------------

export const POST_ASSET_ROLES = ["slide", "cover", "clip", "thumbnail", "audio"] as const;
export type PostAssetRole = (typeof POST_ASSET_ROLES)[number];

/** A post's files, in order. Position is the slide order of a carousel. */
export const postAssets = mysqlTable(
  "post_assets",
  {
    postId: int("post_id").notNull(),
    assetId: int("asset_id").notNull(),
    position: smallint("position").notNull(),
    role: varchar("role", { length: 64, ...{ enum: POST_ASSET_ROLES } })
      .notNull()
      .default("slide"),
  },
  (t) => [
    primaryKey({ columns: [t.postId, t.position] }),
    // "Used in" on the media detail drawer.
    index("post_assets_asset_idx").on(t.assetId),
  ],
);

// ---------------------------------------------------------------------------
// post_metrics / account_metrics
// ---------------------------------------------------------------------------

/** Append-only insight snapshots of one post (§1.51). Null is "not reported", not zero. */
export const postMetrics = mysqlTable(
  "post_metrics",
  {
    id: int("id").primaryKey().autoincrement(),
    postId: int("post_id").notNull(),
    capturedAt: datetime("captured_at", { mode: "date", fsp: 3 })
      .notNull()
      .default(sql`(current_timestamp(3))`),
    reach: int("reach"),
    impressions: int("impressions"),
    plays: int("plays"),
    likes: int("likes"),
    comments: int("comments"),
    saves: int("saves"),
    shares: int("shares"),
    follows: int("follows"),
    profileVisits: int("profile_visits"),
    raw: json("raw"),
  },
  (t) => [index("post_metrics_post_captured_idx").on(t.postId, t.capturedAt)],
);

/** One row per account per day. */
export const accountMetrics = mysqlTable(
  "account_metrics",
  {
    accountId: int("account_id").notNull(),
    date: date("date", { mode: "string" }).notNull(),
    followers: int("followers"),
    reach: int("reach"),
    profileVisits: int("profile_visits"),
    raw: json("raw"),
  },
  (t) => [primaryKey({ columns: [t.accountId, t.date] })],
);

// ---------------------------------------------------------------------------
// social_competitors / competitor_posts
// ---------------------------------------------------------------------------

export const SOCIAL_COMPETITOR_ROLES = ["competitor", "inspiration"] as const;
export type SocialCompetitorRole = (typeof SOCIAL_COMPETITOR_ROLES)[number];

/** Someone else's account a brand studies (S21), the social twin of `brand_sources`. */
export const socialCompetitors = mysqlTable(
  "social_competitors",
  {
    id: int("id").primaryKey().autoincrement(),
    brandId: varchar("brand_id", { length: 255 }).notNull(),
    platform: varchar("platform", { length: 64, ...{ enum: SOCIAL_PLATFORMS } }).notNull(),
    handle: varchar("handle", { length: 255 }).notNull(),
    role: varchar("role", { length: 64, ...{ enum: SOCIAL_COMPETITOR_ROLES } })
      .notNull()
      .default("competitor"),
    externalId: varchar("external_id", { length: 128 }),
    /** Last follower count the sync saw, for engagement-per-follower ranking. */
    followers: int("followers"),
    lastSyncedAt: datetime("last_synced_at", { mode: "date", fsp: 3 }),
    lastError: varchar("last_error", { length: 1024 }),
    createdAt: datetime("created_at", { mode: "date", fsp: 3 })
      .notNull()
      .default(sql`(current_timestamp(3))`),
  },
  (t) => [
    uniqueIndex("social_competitors_brand_platform_handle_idx").on(t.brandId, t.platform, t.handle),
  ],
);

export const competitorPosts = mysqlTable(
  "competitor_posts",
  {
    id: int("id").primaryKey().autoincrement(),
    /** Soft link to `social_competitors.id`. */
    competitorId: int("competitor_id").notNull(),
    externalId: varchar("external_id", { length: 128 }).notNull(),
    permalink: varchar("permalink", { length: 1024 }),
    caption: longtext("caption"),
    /** The platform's own word: IMAGE, VIDEO, CAROUSEL_ALBUM, REEL… */
    mediaType: varchar("media_type", { length: 32 }),
    postedAt: datetime("posted_at", { mode: "date", fsp: 3 }),
    likes: int("likes"),
    comments: int("comments"),
    views: int("views"),
    capturedAt: datetime("captured_at", { mode: "date", fsp: 3 })
      .notNull()
      .default(sql`(current_timestamp(3))`),
  },
  (t) => [
    uniqueIndex("competitor_posts_external_id_idx").on(t.externalId),
    index("competitor_posts_competitor_posted_idx").on(t.competitorId, t.postedAt),
  ],
);

export type BrandFamily = typeof brandFamilies.$inferSelect;
export type NewBrandFamily = typeof brandFamilies.$inferInsert;
export type BrandKit = typeof brandKits.$inferSelect;
export type NewBrandKit = typeof brandKits.$inferInsert;
export type SocialAccount = typeof socialAccounts.$inferSelect;
export type NewSocialAccount = typeof socialAccounts.$inferInsert;
export type Integration = typeof integrations.$inferSelect;
export type NewIntegration = typeof integrations.$inferInsert;
export type Asset = typeof assets.$inferSelect;
export type NewAsset = typeof assets.$inferInsert;
export type Post = typeof posts.$inferSelect;
export type NewPost = typeof posts.$inferInsert;
export type PostAsset = typeof postAssets.$inferSelect;
export type NewPostAsset = typeof postAssets.$inferInsert;
export type PostMetric = typeof postMetrics.$inferSelect;
export type NewPostMetric = typeof postMetrics.$inferInsert;
export type AccountMetric = typeof accountMetrics.$inferSelect;
export type NewAccountMetric = typeof accountMetrics.$inferInsert;
export type SocialCompetitor = typeof socialCompetitors.$inferSelect;
export type NewSocialCompetitor = typeof socialCompetitors.$inferInsert;
export type CompetitorPost = typeof competitorPosts.$inferSelect;
export type NewCompetitorPost = typeof competitorPosts.$inferInsert;

// =============================================================================
// Build 4 (docs/PLAN-build4.md §2): voice, stories (cuentos), video renders,
// glossary, comment drafts, content gaps.
// =============================================================================

// ---------------------------------------------------------------------------
// voice_profiles — a narrator or character voice, with consent on record
// ---------------------------------------------------------------------------

export const voiceProfiles = mysqlTable(
  "voice_profiles",
  {
    id: int("id").primaryKey().autoincrement(),
    /** Stable slug, e.g. `narrador-py-1`, `tito`. */
    key: varchar("key", { length: 64 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    provider: varchar("provider", { length: 64, ...{ enum: VOICE_PROVIDERS } }).notNull(),
    /** The provider's voice id / name (`es-PY-TaniaNeural`, an ElevenLabs id, a Gemini voice name). Null for `manual`. */
    providerVoiceId: varchar("provider_voice_id", { length: 255 }),
    /** Languages this voice may narrate (`VoiceLanguage[]`). */
    languages: json("languages")
      .$type<string[]>()
      .notNull()
      .default(sql`(json_array())`),
    role: varchar("role", { length: 64, ...{ enum: VOICE_ROLES } })
      .notNull()
      .default("narrator"),
    /** For `character` voices: the character's key (a cuentos cast id), so episodes keep one voice. */
    characterKey: varchar("character_key", { length: 128 }),
    /** Soft link to `brands.id`; null = usable by every brand. */
    brandId: varchar("brand_id", { length: 255 }),
    settings: json("settings")
      .$type<VoiceSettings>()
      .notNull()
      .default(sql`(json_object())`),
    /** Cloned/recorded human voices need `signed` before any take (§1.5). */
    consentStatus: varchar("consent_status", { length: 64, ...{ enum: CONSENT_STATUSES } })
      .$type<ConsentStatus>()
      .notNull()
      .default("not_needed"),
    consentPerson: varchar("consent_person", { length: 255 }),
    /** What the consent covers: AI use, commercial, platforms, duration, right to revoke. */
    consentScope: longtext("consent_scope"),
    /** Relative to MEDIA_ROOT: the signed contract. */
    consentDocPath: varchar("consent_doc_path", { length: 1024 }),
    consentSignedAt: datetime("consent_signed_at", { mode: "date", fsp: 3 }),
    consentExpiresAt: datetime("consent_expires_at", { mode: "date", fsp: 3 }),
    active: boolean("active").notNull().default(true),
    notes: longtext("notes"),
    createdAt: datetime("created_at", { mode: "date", fsp: 3 })
      .notNull()
      .default(sql`(current_timestamp(3))`),
    updatedAt: datetime("updated_at", { mode: "date", fsp: 3 })
      .notNull()
      .default(sql`(current_timestamp(3))`),
  },
  (t) => [
    uniqueIndex("voice_profiles_key_idx").on(t.key),
    index("voice_profiles_character_idx").on(t.characterKey),
  ],
);

export type VoiceProfile = typeof voiceProfiles.$inferSelect;

// ---------------------------------------------------------------------------
// pronunciations — respellings applied before TTS
// ---------------------------------------------------------------------------

export const pronunciations = mysqlTable(
  "pronunciations",
  {
    id: int("id").primaryKey().autoincrement(),
    /** As written in scripts, e.g. `Ypacaraí`. Matched as a whole word, case-insensitive. */
    term: varchar("term", { length: 255 }).notNull(),
    /** What the voice is given instead, e.g. `Ipacaraí`. */
    sayAs: longtext("say_as").notNull(),
    /** A `VoiceLanguage`, or `*` for every language. */
    language: varchar("language", { length: 8 }).notNull().default("*"),
    /** `global`, `brand:<id>`, `story:<slug>`, `provider:<name>`. Narrower scopes win. */
    scope: varchar("scope", { length: 128 }).notNull().default("global"),
    reviewStatus: varchar("review_status", { length: 64, ...{ enum: LEXICON_REVIEW_STATUSES } })
      .$type<LexiconReviewStatus>()
      .notNull()
      .default("proposed"),
    reviewedBy: varchar("reviewed_by", { length: 255 }),
    reviewedAt: datetime("reviewed_at", { mode: "date", fsp: 3 }),
    notes: longtext("notes"),
    createdAt: datetime("created_at", { mode: "date", fsp: 3 })
      .notNull()
      .default(sql`(current_timestamp(3))`),
    updatedAt: datetime("updated_at", { mode: "date", fsp: 3 })
      .notNull()
      .default(sql`(current_timestamp(3))`),
  },
  (t) => [uniqueIndex("pronunciations_term_language_scope_idx").on(t.term, t.language, t.scope)],
);

export type Pronunciation = typeof pronunciations.$inferSelect;

// ---------------------------------------------------------------------------
// glossary_terms — Guaraní words a native speaker has approved
// ---------------------------------------------------------------------------

export const GLOSSARY_REGISTERS = ["everyday", "kids", "formal", "slang"] as const;
export type GlossaryRegister = (typeof GLOSSARY_REGISTERS)[number];

export const glossaryTerms = mysqlTable(
  "glossary_terms",
  {
    id: int("id").primaryKey().autoincrement(),
    term: varchar("term", { length: 255 }).notNull(),
    /** `gn` for Guaraní; the table is language-keyed so other local terms fit too. */
    language: varchar("language", { length: 8 }).notNull().default("gn"),
    meaningEs: longtext("meaning_es"),
    meaningEn: longtext("meaning_en"),
    /** Respelling for TTS; also offered to the pronunciation dictionary. */
    sayAs: longtext("say_as"),
    partOfSpeech: varchar("part_of_speech", { length: 32 }),
    register: varchar("register", { length: 64, ...{ enum: GLOSSARY_REGISTERS } })
      .notNull()
      .default("everyday"),
    /** May the script writer drop it into Jopará lines? Only approved + true terms are offered (§1.2). */
    joparaOk: boolean("jopara_ok").notNull().default(false),
    example: longtext("example"),
    exampleTranslation: longtext("example_translation"),
    reviewStatus: varchar("review_status", { length: 64, ...{ enum: LEXICON_REVIEW_STATUSES } })
      .$type<LexiconReviewStatus>()
      .notNull()
      .default("proposed"),
    reviewedBy: varchar("reviewed_by", { length: 255 }),
    reviewedAt: datetime("reviewed_at", { mode: "date", fsp: 3 }),
    source: varchar("source", { length: 255 }),
    notes: longtext("notes"),
    createdAt: datetime("created_at", { mode: "date", fsp: 3 })
      .notNull()
      .default(sql`(current_timestamp(3))`),
    updatedAt: datetime("updated_at", { mode: "date", fsp: 3 })
      .notNull()
      .default(sql`(current_timestamp(3))`),
  },
  (t) => [
    uniqueIndex("glossary_terms_term_language_idx").on(t.term, t.language),
    index("glossary_terms_review_idx").on(t.reviewStatus),
  ],
);

export type GlossaryTerm = typeof glossaryTerms.$inferSelect;

// ---------------------------------------------------------------------------
// narrations — every audio take, kept (take history)
// ---------------------------------------------------------------------------

export const narrations = mysqlTable(
  "narrations",
  {
    id: int("id").primaryKey().autoincrement(),
    ownerKind: varchar("owner_kind", { length: 64, ...{ enum: NARRATION_OWNER_KINDS } }).notNull(),
    ownerRef: varchar("owner_ref", { length: 255 }).notNull(),
    sceneRef: varchar("scene_ref", { length: 64 }),
    language: varchar("language", { length: 8 }).notNull(),
    voiceProfileId: int("voice_profile_id"),
    /** Character key for a dialogue line; null = narrator. */
    speaker: varchar("speaker", { length: 128 }),
    /** The approved text as given. */
    inputText: longtext("input_text").notNull(),
    /** What the provider was actually sent, after pronunciations. */
    spokenText: longtext("spoken_text"),
    /** sha256 of inputText + voice + language: a re-take of unchanged text is visible as such. */
    textHash: char("text_hash", { length: 64 }).notNull(),
    provider: varchar("provider", { length: 64, ...{ enum: VOICE_PROVIDERS } }).notNull(),
    status: varchar("status", { length: 64, ...{ enum: NARRATION_STATUSES } })
      .notNull()
      .default("pending"),
    /** Soft links to `assets.id`: the WAV master and the MP3 playback copy. */
    masterAssetId: int("master_asset_id"),
    playbackAssetId: int("playback_asset_id"),
    durationMs: int("duration_ms"),
    alignment: json("alignment").$type<WordTiming[]>(),
    costUsd: double("cost_usd").notNull().default(0),
    /** Build 5: Higgsfield credits the take cost, when a Higgsfield engine made it. */
    costCredits: double("cost_credits"),
    /** Build 5: soft link to `higgsfield_jobs.id` for takes made in a Higgsfield batch. */
    higgsfieldJobId: int("higgsfield_job_id"),
    /** Build 5: the provider's own id for the take (a Higgsfield job id, a Replicate prediction id). */
    externalRef: varchar("external_ref", { length: 255 }),
    /** The chosen take for its (owner, scene, language, speaker). At most one is selected. */
    selected: boolean("selected").notNull().default(false),
    reviewStatus: varchar("review_status", { length: 64, ...{ enum: TAKE_REVIEW_STATUSES } })
      .notNull()
      .default("unreviewed"),
    reviewNote: longtext("review_note"),
    reviewedBy: varchar("reviewed_by", { length: 255 }),
    error: varchar("error", { length: 1024 }),
    createdAt: datetime("created_at", { mode: "date", fsp: 3 })
      .notNull()
      .default(sql`(current_timestamp(3))`),
  },
  (t) => [
    index("narrations_owner_idx").on(t.ownerKind, t.ownerRef, t.sceneRef, t.language),
    index("narrations_voice_idx").on(t.voiceProfileId),
  ],
);

export type Narration = typeof narrations.$inferSelect;

// ---------------------------------------------------------------------------
// stories / story_scenes — cuentos.com.py books imported from CUENTOS_ROOT
// ---------------------------------------------------------------------------

export const STORY_SCENE_KINDS = ["page", "cover", "back"] as const;
export type StorySceneKind = (typeof STORY_SCENE_KINDS)[number];

/** One spoken line in a scene: the narrator's or a character's. */
export type StoryLine = { speaker: string | null; text: string };

export const stories = mysqlTable(
  "stories",
  {
    id: int("id").primaryKey().autoincrement(),
    /** The book folder name under `books/`, e.g. `tito-salto-chiquito`. */
    slug: varchar("slug", { length: 255 }).notNull(),
    title: longtext("title").notNull(),
    series: varchar("series", { length: 255 }),
    /** Free text in the repo, e.g. "7–10 · libro por capítulos para primeros lectores…". */
    ageBand: longtext("age_band"),
    /** Relative to CUENTOS_ROOT, forward slashes, e.g. `books/tito-salto-chiquito`. */
    sourcePath: varchar("source_path", { length: 1024 }).notNull(),
    /** sha256 of story.json at the last import: "changed on disk" is a compare. */
    sourceSha: char("source_sha", { length: 64 }),
    /** story.json as imported, verbatim. The repo stays the source of truth for text. */
    raw: json("raw"),
    /** Languages the book has text for (`es`, `gn`, `jopara`, `en`…). */
    languages: json("languages")
      .$type<string[]>()
      .notNull()
      .default(sql`(json_array())`),
    /** Soft link to `brands.id` (the cuentos brand), for media folders and publishing. */
    brandId: varchar("brand_id", { length: 255 }),
    notes: longtext("notes"),
    importedAt: datetime("imported_at", { mode: "date", fsp: 3 })
      .notNull()
      .default(sql`(current_timestamp(3))`),
    createdAt: datetime("created_at", { mode: "date", fsp: 3 })
      .notNull()
      .default(sql`(current_timestamp(3))`),
    updatedAt: datetime("updated_at", { mode: "date", fsp: 3 })
      .notNull()
      .default(sql`(current_timestamp(3))`),
  },
  (t) => [uniqueIndex("stories_slug_idx").on(t.slug)],
);

export type Story = typeof stories.$inferSelect;

export const storyScenes = mysqlTable(
  "story_scenes",
  {
    id: int("id").primaryKey().autoincrement(),
    storyId: int("story_id").notNull(),
    /** The page id from story.json (`S01`). Stable across re-imports. */
    sceneRef: varchar("scene_ref", { length: 64 }).notNull(),
    position: smallint("position").notNull(),
    kind: varchar("kind", { length: 64, ...{ enum: STORY_SCENE_KINDS } })
      .notNull()
      .default("page"),
    /** Text per language; null = no text in that language (never filled from another language). */
    text: json("text")
      .$type<Record<string, string | null>>()
      .notNull()
      .default(sql`(json_object())`),
    /** Review status per language as the repo states it (`approved`, `pending-review`…). */
    textStatus: json("text_status")
      .$type<Record<string, string>>()
      .notNull()
      .default(sql`(json_object())`),
    /** Narration lines per language, split by speaker. Empty = narrate `text` as one narrator line. */
    lines: json("lines")
      .$type<Record<string, StoryLine[]>>()
      .notNull()
      .default(sql`(json_object())`),
    /** Selected art, relative to CUENTOS_ROOT. */
    artPath: varchar("art_path", { length: 1024 }),
    artWidth: int("art_width"),
    artHeight: int("art_height"),
    alt: longtext("alt"),
    artBrief: longtext("art_brief"),
    notes: longtext("notes"),
    updatedAt: datetime("updated_at", { mode: "date", fsp: 3 })
      .notNull()
      .default(sql`(current_timestamp(3))`),
  },
  (t) => [uniqueIndex("story_scenes_story_scene_idx").on(t.storyId, t.sceneRef)],
);

export type StoryScene = typeof storyScenes.$inferSelect;

// ---------------------------------------------------------------------------
// video_renders
// ---------------------------------------------------------------------------

export const videoRenders = mysqlTable(
  "video_renders",
  {
    id: int("id").primaryKey().autoincrement(),
    ownerKind: varchar("owner_kind", { length: 64, ...{ enum: RENDER_OWNER_KINDS } }).notNull(),
    ownerRef: varchar("owner_ref", { length: 255 }).notNull(),
    language: varchar("language", { length: 8 }).notNull(),
    format: varchar("format", { length: 64, ...{ enum: VIDEO_FORMATS } }).notNull(),
    status: varchar("status", { length: 64, ...{ enum: RENDER_STATUSES } })
      .notNull()
      .default("queued"),
    /** The resolved timeline (scene starts, durations, cues) — what was rendered, for re-renders. */
    plan: json("plan"),
    outputAssetId: int("output_asset_id"),
    srtAssetId: int("srt_asset_id"),
    vttAssetId: int("vtt_asset_id"),
    durationMs: int("duration_ms"),
    error: varchar("error", { length: 1024 }),
    startedAt: datetime("started_at", { mode: "date", fsp: 3 }),
    finishedAt: datetime("finished_at", { mode: "date", fsp: 3 }),
    createdAt: datetime("created_at", { mode: "date", fsp: 3 })
      .notNull()
      .default(sql`(current_timestamp(3))`),
  },
  (t) => [index("video_renders_owner_idx").on(t.ownerKind, t.ownerRef, t.language)],
);

export type VideoRender = typeof videoRenders.$inferSelect;

// ---------------------------------------------------------------------------
// comment_drafts — reply suggestions, never auto-sent
// ---------------------------------------------------------------------------

export const COMMENT_DRAFT_STATUSES = [
  "new",
  "drafted",
  "approved",
  "replied",
  "dismissed",
] as const;
export type CommentDraftStatus = (typeof COMMENT_DRAFT_STATUSES)[number];

export const commentDrafts = mysqlTable(
  "comment_drafts",
  {
    id: int("id").primaryKey().autoincrement(),
    accountId: int("account_id").notNull(),
    postId: int("post_id"),
    platform: varchar("platform", { length: 64, ...{ enum: SOCIAL_PLATFORMS } }).notNull(),
    externalCommentId: varchar("external_comment_id", { length: 128 }).notNull(),
    externalMediaId: varchar("external_media_id", { length: 128 }),
    author: varchar("author", { length: 255 }),
    commentText: longtext("comment_text").notNull(),
    commentedAt: datetime("commented_at", { mode: "date", fsp: 3 }),
    language: varchar("language", { length: 8 }),
    draft: longtext("draft"),
    status: varchar("status", { length: 64, ...{ enum: COMMENT_DRAFT_STATUSES } })
      .notNull()
      .default("new"),
    error: varchar("error", { length: 1024 }),
    createdAt: datetime("created_at", { mode: "date", fsp: 3 })
      .notNull()
      .default(sql`(current_timestamp(3))`),
    updatedAt: datetime("updated_at", { mode: "date", fsp: 3 })
      .notNull()
      .default(sql`(current_timestamp(3))`),
  },
  (t) => [
    uniqueIndex("comment_drafts_platform_comment_idx").on(t.platform, t.externalCommentId),
    index("comment_drafts_account_status_idx").on(t.accountId, t.status),
  ],
);

export type CommentDraft = typeof commentDrafts.$inferSelect;

// ---------------------------------------------------------------------------
// content_gaps — "competitors cover X, you don't"
// ---------------------------------------------------------------------------

export const CONTENT_GAP_STATUSES = ["new", "planned", "dismissed"] as const;
export type ContentGapStatus = (typeof CONTENT_GAP_STATUSES)[number];

export type ContentGapEvidence = { kind: string; ref: string; note: string };

export const contentGaps = mysqlTable(
  "content_gaps",
  {
    id: int("id").primaryKey().autoincrement(),
    brandId: varchar("brand_id", { length: 255 }).notNull(),
    topic: longtext("topic").notNull(),
    angle: longtext("angle"),
    evidence: json("evidence")
      .$type<ContentGapEvidence[]>()
      .notNull()
      .default(sql`(json_array())`),
    /** 1–10, the model's estimate of demand × how uncovered it is. */
    score: smallint("score"),
    status: varchar("status", { length: 64, ...{ enum: CONTENT_GAP_STATUSES } })
      .notNull()
      .default("new"),
    /** Soft link to `ideas.id` once turned into an idea. */
    ideaId: int("idea_id"),
    createdAt: datetime("created_at", { mode: "date", fsp: 3 })
      .notNull()
      .default(sql`(current_timestamp(3))`),
  },
  (t) => [index("content_gaps_brand_status_idx").on(t.brandId, t.status)],
);

export type ContentGap = typeof contentGaps.$inferSelect;

// ---------------------------------------------------------------------------
// higgsfield_jobs — generation runs the app hands to Claude Code + the
// Higgsfield MCP on Anton's PC (build 4 §3.H). The app never holds a
// Higgsfield key; it spawns the logged-in `claude` CLI with a slash command.
// ---------------------------------------------------------------------------

export const HIGGSFIELD_JOB_KINDS = [
  "post",
  "script_shots",
  "script_thumbnails",
  "import",
  "free",
  // Build 5: narration takes made with Higgsfield's TTS engines.
  "voice",
] as const;
export type HiggsfieldJobKind = (typeof HIGGSFIELD_JOB_KINDS)[number];
export const HIGGSFIELD_JOB_STATUSES = [
  "queued",
  "running",
  "done",
  "failed",
  "cancelled",
] as const;
export type HiggsfieldJobStatus = (typeof HIGGSFIELD_JOB_STATUSES)[number];

export const higgsfieldJobs = mysqlTable(
  "higgsfield_jobs",
  {
    id: int("id").primaryKey().autoincrement(),
    kind: varchar("kind", { length: 64, ...{ enum: HIGGSFIELD_JOB_KINDS } }).notNull(),
    /** What it generates for: `post:<id>`, `script:<id>`, or null for an import/free prompt. */
    targetRef: varchar("target_ref", { length: 255 }),
    /** Soft link to `brands.id`, for filtering and the media folder. */
    brandId: varchar("brand_id", { length: 255 }),
    /** The exact prompt handed to `claude -p` (slash command + inline brief). */
    prompt: longtext("prompt").notNull(),
    /** Hard ceiling in Higgsfield credits for this run; the command preflights costs against it. */
    maxCredits: double("max_credits").notNull(),
    /** Balance delta reported by the run (balance before − after), when known. */
    creditsUsed: double("credits_used"),
    status: varchar("status", { length: 64, ...{ enum: HIGGSFIELD_JOB_STATUSES } })
      .notNull()
      .default("queued"),
    /** Higgsfield job ids reported by the run, so a timeout never resubmits. */
    externalJobIds: json("external_job_ids")
      .$type<string[]>()
      .notNull()
      .default(sql`(json_array())`),
    /** Files written, relative to MEDIA_ROOT. */
    outputPaths: json("output_paths")
      .$type<string[]>()
      .notNull()
      .default(sql`(json_array())`),
    /** Tail of the CLI output (bounded), for the job page. */
    log: longtext("log"),
    error: varchar("error", { length: 1024 }),
    pid: int("pid"),
    workerHost: varchar("worker_host", { length: 255 }),
    workerInstance: varchar("worker_instance", { length: 64 }),
    leaseName: varchar("lease_name", { length: 255 }),
    leaseHolder: varchar("lease_holder", { length: 64 }),
    heartbeatAt: datetime("heartbeat_at", { mode: "date", fsp: 3 }),
    recoveryOfJobId: int("recovery_of_job_id"),
    startedAt: datetime("started_at", { mode: "date", fsp: 3 }),
    finishedAt: datetime("finished_at", { mode: "date", fsp: 3 }),
    createdAt: datetime("created_at", { mode: "date", fsp: 3 })
      .notNull()
      .default(sql`(current_timestamp(3))`),
  },
  (t) => [
    index("higgsfield_jobs_status_idx").on(t.status),
    index("higgsfield_jobs_target_idx").on(t.targetRef),
  ],
);

export type HiggsfieldJob = typeof higgsfieldJobs.$inferSelect;
