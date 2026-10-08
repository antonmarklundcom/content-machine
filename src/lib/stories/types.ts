/**
 * Shapes shared by the cuentos story studio (build 4 §3.C). Pure types: the
 * parser, the rules and the render-request builder are unit-tested without a
 * database, so nothing here imports `server-only` or `@/db`.
 */
import type { StoryLine, StorySceneKind } from "@/db/schema";

export type { StoryLine };

/** One scene as the parser reads it from the book folder. */
export type ParsedScene = {
  /** The page id from story.json (`S01`). */
  sceneRef: string;
  /** 1-based order in the book. */
  position: number;
  kind: StorySceneKind;
  /** Text per story language (`es`, `gn`, `jopara`, `en`); null = not written. Verbatim. */
  text: Record<string, string | null>;
  /** Review status per language as the repo states it. */
  textStatus: Record<string, string>;
  /** Narration lines per language when an audio script splits the text by speaker. */
  lines: Record<string, StoryLine[]>;
  /** Selected art, relative to CUENTOS_ROOT (forward slashes), or null. */
  artPath: string | null;
  alt: string | null;
  artBrief: string | null;
};

export type ImportFileReport = {
  /** Things the parser read but could not use, or chose not to (never silently dropped). */
  warnings: string[];
  /** Files in the book folder the importer does not understand, relative to the book. */
  unknownFiles: string[];
};

export type ParsedStory = {
  slug: string;
  title: string;
  series: string | null;
  ageBand: string | null;
  /** Story languages that have text in at least one scene, `es` first. */
  languages: string[];
  scenes: ParsedScene[];
  report: ImportFileReport;
};

/** A JSON file from the book folder, already parsed (or the parse error). */
export type BookJsonFile = { path: string; data: unknown } | { path: string; error: string };

/** Everything the parser needs, read from `books/<slug>/` by `loadBook`. */
export type BookFiles = {
  slug: string;
  /** story.json, parsed. */
  story: unknown;
  /** art/manifest.json, parsed, when present. */
  artManifest?: unknown;
  /** JSON files under `languages/` (paths relative to the book, forward slashes). */
  languageFiles: BookJsonFile[];
  /** JSON files under `audio/`. */
  audioFiles: BookJsonFile[];
  /** Every file in the book folder (relative to the book), for art existence checks and the unknown-file report. */
  files: string[];
};

/** In-app metadata kept in `story_scenes.notes` (JSON): approvals and built scene audio. */
export type SceneApproval = {
  by: string;
  at: string;
  /** The repo's status when the owner approved here; a change on re-import drops the approval. */
  repoStatus: string | null;
  /** sha256 of the text approved; a text change drops the approval. */
  textSha: string;
};

export type SceneAudio = {
  /** Relative to MEDIA_ROOT. */
  wavPath: string;
  mp3Path: string | null;
  durationMs: number;
  alignment: { word: string; startMs: number; endMs: number }[] | null;
  /** The selected take ids (in line order) this file was built from. */
  takeIds: number[];
  builtAt: string;
};

export type SceneMeta = {
  approvals?: Record<string, SceneApproval>;
  audio?: Record<string, SceneAudio>;
};
