/**
 * JSON shapes stored by the build 2b studio extras (ideas 1–8, 10). The
 * tables are in src/db/schema.ts; these are what their jsonb columns hold.
 */

/** `competitor_reports.body` (idea 1). */
export type CompetitorReport = {
  /** Two to four sentences: what happened among the competitors this period. */
  summary: string;
  /** The videos that took off, with the reason the model sees. */
  winners: Array<{
    videoId: number;
    title: string;
    channel: string;
    outlierScore: number;
    whyItWorked: string;
  }>;
  /** Patterns across winners — hooks, formats, title shapes. */
  patterns: string[];
  /** Video ideas for Anton, never copies of a competitor's video. */
  ideas: Array<{ title: string; angle: string; basedOnVideoIds: number[] }>;
};

/** `scripts.publish_pack` (idea 6). */
export type PublishPack = {
  description: string;
  /** "0:00 Intro" lines, estimated from spoken word counts unless edited. */
  chapters: Array<{ time: string; title: string }>;
  tags: string[];
  pinnedComment: string;
  captions: { instagram: string; facebook: string; tiktok: string };
  generatedAt: string;
};
