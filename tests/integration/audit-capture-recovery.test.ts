import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, afterEach, beforeEach, mock, test } from "node:test";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { insertReturning } from "@/db/mutations";
import { fakeGeminiClient } from "@/lib/ai-fake";
import { approveSharedMediaIdentity } from "@/lib/media/privacy";
import { findPendingVideos } from "@/lib/analysis/run";
import { DEFAULT_AUTOMATION_POLICY } from "@/lib/automation/policy";
import { saveAutomationPolicy } from "@/lib/automation/store";
import { fetchClip } from "@/lib/clips/fetch";
import { reapStuckClips } from "@/lib/clips/recovery";
import { clipWorkLease } from "@/lib/clips/work";
import { ClipWorkBusyError } from "@/lib/clips/work";
import { saveClip, updateClipCapture } from "@/lib/clips/save";
import { upsertVideoFromMetadata } from "@/lib/ingest/store";
import {
  retainStoredTranscript,
  storeFetchedCaptions,
  storeManualTranscript,
} from "@/lib/ingest/transcripts";
import { acquireLease, releaseLease } from "@/lib/lease";
import { processLearnClip } from "@/lib/learn/process";
import { listSourcesForPolling } from "@/lib/sources";
import { resetTables, teardown } from "./setup";

let mediaRoot = "";
const originalMediaRoot = process.env.MEDIA_ROOT;
beforeEach(async () => {
  mock.restoreAll();
  await resetTables();
});
afterEach(() => {
  mock.restoreAll();
  if (mediaRoot) {
    assert.equal(path.dirname(mediaRoot), path.resolve(tmpdir()));
    rmSync(mediaRoot, { recursive: true, force: true });
    mediaRoot = "";
  }
  if (originalMediaRoot === undefined) delete process.env.MEDIA_ROOT;
  else process.env.MEDIA_ROOT = originalMediaRoot;
});
after(teardown);

async function video(status: typeof schema.videos.$inferInsert.captionStatus = "unknown") {
  const [row] = await insertReturning(db, schema.videos, {
    youtubeId: "auditvid001",
    title: "Synthetic transcript fixture",
    captionStatus: status,
  });
  return row;
}

test("manual evidence becomes pending analysis and survives forced or late fetched captions", async () => {
  const v = await video("none");
  await storeManualTranscript(v.id, "Owner reviewed transcript.");
  assert.equal(
    (await findPendingVideos()).some((row) => row.id === v.id),
    true,
  );
  assert.equal(await retainStoredTranscript(v.id, true), true);
  for (const result of [
    { status: "available", language: "en", wordCount: 2, content: "Fetched substitute" },
    { status: "failed" },
    { status: "none" },
  ] as const) {
    assert.equal(await storeFetchedCaptions(v.id, result), false);
  }
  const [stored] = await db
    .select()
    .from(schema.transcripts)
    .where(eq(schema.transcripts.videoId, v.id));
  const [updated] = await db.select().from(schema.videos).where(eq(schema.videos.id, v.id));
  assert.equal(stored.content, "Owner reviewed transcript.");
  assert.equal(stored.source, "manual");
  assert.equal(updated.captionStatus, "available");
});

test("concurrent manual and fetched transcript commits leave coherent manual provenance", async () => {
  const v = await video("failed");
  await Promise.all([
    storeManualTranscript(v.id, "The final owner evidence."),
    storeFetchedCaptions(v.id, {
      status: "available",
      language: "en",
      wordCount: 2,
      content: "Network evidence",
    }),
  ]);
  const [stored] = await db
    .select()
    .from(schema.transcripts)
    .where(eq(schema.transcripts.videoId, v.id));
  const [updated] = await db.select().from(schema.videos).where(eq(schema.videos.id, v.id));
  assert.equal(stored.source, "manual");
  assert.equal(stored.content, "The final owner evidence.");
  assert.equal(updated.captionStatus, "available");
});

test("legacy status mismatches are repaired from stored evidence before any caption request", async () => {
  const v = await video("none");
  await db
    .insert(schema.transcripts)
    .values({ videoId: v.id, source: "manual", content: "Existing manual text", wordCount: 3 });
  assert.equal(await retainStoredTranscript(v.id, true), true);
  const [updated] = await db.select().from(schema.videos).where(eq(schema.videos.id, v.id));
  assert.equal(updated.captionStatus, "available");
});

test("stale capture recovery works with automation off and respects active clip ownership", async () => {
  await saveAutomationPolicy(DEFAULT_AUTOMATION_POLICY);
  const old = sql`date_sub(current_timestamp(3), interval 20 minute)`;
  const [abandoned, active, fresh] = await insertReturning(db, schema.clips, [
    { url: "https://synthetic.invalid/abandoned", status: "ingesting", ingestStartedAt: old },
    { url: "https://synthetic.invalid/active", status: "ingesting", ingestStartedAt: old },
    {
      url: "https://synthetic.invalid/fresh",
      status: "ingesting",
      ingestStartedAt: sql`current_timestamp(3)`,
    },
  ]);
  const lease = await acquireLease(clipWorkLease(active.id), 60_000);
  assert.ok(lease);
  try {
    assert.equal(await reapStuckClips(), 1);
    const state = new Map(
      (await db.select().from(schema.clips)).map((row) => [row.id, row.status]),
    );
    assert.equal(state.get(abandoned.id), "failed");
    assert.equal(state.get(active.id), "ingesting");
    assert.equal(state.get(fresh.id), "ingesting");
    assert.equal(fakeGeminiClient().calls.length, 0);
  } finally {
    await releaseLease(lease);
  }
  assert.equal(await reapStuckClips(), 1);
});

test(
  "fetch and learning exclude each other, and changed source invalidates the old lesson",
  { timeout: 30_000 },
  async () => {
    mediaRoot = mkdtempSync(path.join(tmpdir(), "content-machine-audit-capture-"));
    process.env.MEDIA_ROOT = mediaRoot;
    const bytes = Buffer.from("synthetic media bytes for the fake provider");
    writeFileSync(path.join(mediaRoot, "fixture.jpg"), bytes);
    const [asset] = await insertReturning(db, schema.assets, {
      kind: "image",
      mime: "image/jpeg",
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      localPath: "fixture.jpg",
      source: "capture",
    });
    await approveSharedMediaIdentity(asset.sha256, mediaRoot);
    const [clip] = await insertReturning(db, schema.clips, {
      url: "https://synthetic.invalid/learning",
      purpose: "learn",
      mediaAssetId: asset.id,
      postText: "Old caption",
      transcript: "Old transcript",
      summary: "Old learning summary",
      learnCategory: "learning-resource",
      howToStart: ["Old step"],
      learnDetails: { takeaways: ["Old takeaway"], resources: [], limitations: [] },
    });
    const fake = fakeGeminiClient();
    const generate = fake.models.generateContent.bind(fake.models);
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    mock.method(fake.models, "generateContent", async (...args: Parameters<typeof generate>) => {
      entered();
      await gate;
      return generate(...args);
    });
    const running = fetchClip(clip.id, { force: true });
    try {
      await started;
      assert.equal((await fetchClip(clip.id, { force: true })).status, "busy");
      await assert.rejects(
        updateClipCapture(clip.id, { brandId: null, purpose: "competitor", tags: ["changed"] }),
        ClipWorkBusyError,
      );
      const learning = await processLearnClip(clip.id, {
        deps: {
          run: async () => {
            throw new Error("A competing learning call must not run.");
          },
          fetchPage: async () => {
            throw new Error("A competing fetch must not run.");
          },
        },
      });
      assert.equal(learning.status, "skipped");
    } finally {
      release();
    }
    assert.equal((await running).status, "done");
    assert.equal(fake.callsOf("generateContent").length, 1);
    const [updated] = await db.select().from(schema.clips).where(eq(schema.clips.id, clip.id));
    assert.notEqual(updated.transcript, "Old transcript");
    assert.equal(updated.purpose, "learn", "a busy metadata edit cannot change the work's purpose");
    for (const value of [
      updated.summary,
      updated.learnCategory,
      updated.howToStart,
      updated.learnDetails,
    ])
      assert.equal(value, null);
    assert.equal((await fetchClip(clip.id)).status, "done");
    assert.equal(
      fake.callsOf("generateContent").length,
      1,
      "a stale automatic work list cannot pay for a second transcript",
    );
  },
);

test("source polling is null-first and stable; a second source cannot steal a video", async () => {
  const [recent, neverA, neverB, oldest] = await insertReturning(db, schema.sources, [
    {
      kind: "playlist",
      youtubeId: "audit-recent",
      title: "Recent",
      url: "https://synthetic.invalid/recent",
      lastPolledAt: new Date("2026-01-02T00:00:00Z"),
    },
    {
      kind: "playlist",
      youtubeId: "audit-never-a",
      title: "Never A",
      url: "https://synthetic.invalid/never-a",
    },
    {
      kind: "playlist",
      youtubeId: "audit-never-b",
      title: "Never B",
      url: "https://synthetic.invalid/never-b",
    },
    {
      kind: "playlist",
      youtubeId: "audit-oldest",
      title: "Oldest",
      url: "https://synthetic.invalid/oldest",
      lastPolledAt: new Date("2026-01-01T00:00:00Z"),
    },
  ]);
  assert.deepEqual(
    (await listSourcesForPolling()).map((row) => row.id),
    [neverA.id, neverB.id, oldest.id, recent.id],
  );
  const metadata = {
    youtubeId: "auditvid001",
    title: "Shared synthetic video",
    description: "Synthetic fixture",
    channelTitle: "Synthetic channel",
    channelId: "synthetic-channel",
    publishedAt: null,
    durationSeconds: null,
    viewCount: null,
    likeCount: null,
    commentCount: null,
    thumbnailUrl: null,
    isLive: false,
  };
  const first = await upsertVideoFromMetadata(metadata, recent.id);
  const second = await upsertVideoFromMetadata(metadata, oldest.id);
  assert.equal(second.id, first.id);
  assert.equal(second.sourceId, recent.id);
});

test("duplicate capture note changes respect clip ownership and invalidate learned context", async () => {
  const [clip] = await insertReturning(db, schema.clips, {
    url: "https://synthetic.invalid/note-context",
    purpose: "learn",
    note: "Original owner context",
    summary: "Derived from original context",
    learnCategory: "learning-resource",
    howToStart: ["Original step"],
    learnDetails: { takeaways: ["Original takeaway"], resources: [], limitations: [] },
  });
  const lease = await acquireLease(clipWorkLease(clip.id), 60_000);
  assert.ok(lease);
  try {
    const unchanged = await saveClip({ url: clip.url, note: clip.note });
    assert.equal(unchanged.ok, true, "an unchanged duplicate does not mutate busy context");
    const refused = await saveClip({ url: clip.url, note: "New owner context" });
    assert.equal(refused.ok, false);
    const [stillHeld] = await db.select().from(schema.clips).where(eq(schema.clips.id, clip.id));
    assert.equal(stillHeld.note, clip.note);
    assert.equal(stillHeld.summary, clip.summary);
  } finally {
    await releaseLease(lease);
  }
  const changed = await saveClip({ url: clip.url, note: "New owner context" });
  assert.ok(changed.ok);
  assert.equal(changed.created, false);
  assert.equal(changed.clip.note, "New owner context");
  for (const value of [
    changed.clip.summary,
    changed.clip.learnCategory,
    changed.clip.howToStart,
    changed.clip.learnDetails,
  ])
    assert.equal(value, null);
  assert.equal(fakeGeminiClient().calls.length, 0);
});
