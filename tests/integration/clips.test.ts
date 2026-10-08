import { insertReturning } from "@/db/mutations";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";

import { eq } from "drizzle-orm";

import { db, schema } from "@/db";
import { clipCountsByStatus, getClip, getClipByUrl, listClips } from "@/lib/bridge";
import { saveClip } from "@/lib/clips/save";

import { resetTables, teardown } from "./setup";

/**
 * The clip inbox's write path and the bridge reads over it (PLAN.md §5.O4.3).
 *
 * `saveClip` is one upsert carrying three separate promises — never a second
 * row, never a clobbered note, and an honest `created` flag — and all three are
 * decided by `on conflict do update` and the unique index under it. This is the
 * only place they can actually be checked.
 */

const YT = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

beforeEach(resetTables);
after(teardown);

test("a first save stores the URL, platform and note, and reports created", async () => {
  const result = await saveClip({ url: YT, note: "  the hook in the first 3s  " });

  assert.equal(result.ok, true);
  assert.ok(result.ok);
  assert.equal(result.created, true);
  assert.equal(result.clip.platform, "youtube");
  assert.equal(result.clip.note, "the hook in the first 3s", "the note is trimmed");
  assert.equal(result.clip.status, "unprocessed");
  assert.equal(result.clip.videoId, null);
});

test("re-saving the same link updates in place and reports created: false", async () => {
  const first = await saveClip({ url: YT, note: "first" });
  const second = await saveClip({ url: YT, note: "second" });

  assert.ok(first.ok && second.ok);
  assert.equal(second.created, false);
  assert.equal(second.clip.id, first.clip.id, "the same row, not a second one");
  assert.equal(second.clip.note, "second");
  assert.equal((await db.select().from(schema.clips)).length, 1);
});

test("a re-save with no note keeps the note the clip already had", async () => {
  // The share sheet sends an empty field far more often than a correction, so
  // `coalesce(excluded.note, note)` has to survive contact with real SQL — an
  // upsert that wrote NULL here would erase the one field §1.7 guarantees.
  await saveClip({ url: YT, note: "why I saved this" });

  for (const note of [undefined, null, "", "   "]) {
    const again = await saveClip({ url: YT, note });
    assert.ok(again.ok);
    assert.equal(
      again.clip.note,
      "why I saved this",
      `note survived a re-save with ${JSON.stringify(note)}`,
    );
  }
});

test("a re-save never resets a clip that has since been processed", async () => {
  const first = await saveClip({ url: YT, note: "original" });
  assert.ok(first.ok);

  const [video] = await insertReturning(db, schema.videos, {
    youtubeId: "dQw4w9WgXcQ",
    title: "A video",
  });
  await db
    .update(schema.clips)
    .set({ status: "analyzed", videoId: video.id, title: "A video" })
    .where(eq(schema.clips.id, first.clip.id));

  const again = await saveClip({ url: YT, note: "re-shared" });
  assert.ok(again.ok);
  assert.equal(again.clip.status, "analyzed", "status is untouched by a re-save");
  assert.equal(again.clip.videoId, video.id, "and so is the video it was ingested into");
  assert.equal(again.clip.note, "re-shared", "only the note moves");
});

test("URLs that canonicalise the same are one clip", async () => {
  // Scheme, `www.`, the fragment, parameter order and the share-tracking
  // allowlist in clips/url.ts all normalise away, so these are one save.
  await saveClip({ url: "https://www.youtube.com/watch?v=abc123&si=Xy_9&feature=share" });
  await saveClip({ url: "HTTP://youtube.com/watch?v=abc123#t=30" });

  const rows = await db.select().from(schema.clips);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].url, "https://youtube.com/watch?v=abc123");
});

test("a URL that differs outside the allowlist is deliberately a second clip", async () => {
  // canonicalClipUrl strips a named list of junk and nothing else, on the
  // reasoning that a duplicate row is a nuisance while a collision silently
  // overwrites someone else's note. `utm_*` joined that list in O9 (the case
  // for it is in docs/log/o4.md); any other parameter still makes a new clip.
  await saveClip({ url: "https://www.youtube.com/watch?v=abc123" });
  await saveClip({ url: "https://www.youtube.com/watch?v=abc123&utm_source=twitter" });
  await saveClip({ url: "https://www.youtube.com/watch?v=abc123&list=PL1" });

  assert.equal((await db.select().from(schema.clips)).length, 2);
});

test("a non-http URL is refused rather than stored", async () => {
  for (const url of ["not a url", "javascript:alert(1)", "ftp://example.com/x", ""]) {
    const result = await saveClip({ url });
    assert.equal(result.ok, false, `refused ${JSON.stringify(url)}`);
  }
  assert.equal((await db.select().from(schema.clips)).length, 0);
});

test("platform is derived from the URL at save time", async () => {
  await saveClip({ url: YT });
  await saveClip({ url: "https://www.instagram.com/reel/Cxyz/" });
  await saveClip({ url: "https://www.facebook.com/watch/?v=123" });
  await saveClip({ url: "https://example.com/some-article" });

  const rows = await db.select().from(schema.clips).orderBy(schema.clips.id);
  assert.deepEqual(
    rows.map((r) => r.platform),
    ["youtube", "instagram", "facebook", "other"],
  );
});

test("the inbox lists newest first and joins the video when there is one", async () => {
  const saved = await saveClip({ url: YT, note: "with a video" });
  assert.ok(saved.ok);
  const [video] = await insertReturning(db, schema.videos, {
    youtubeId: "dQw4w9WgXcQ",
    title: "The joined title",
  });
  await db
    .update(schema.clips)
    .set({ videoId: video.id })
    .where(eq(schema.clips.id, saved.clip.id));

  await saveClip({ url: "https://www.instagram.com/reel/Cxyz/", note: "no video, still useful" });

  const page = await listClips();
  assert.equal(page.total, 2);
  assert.equal(page.totalPages, 1);
  // A LEFT JOIN, so the clip with nothing fetched is a row and not a gap (§1.7),
  // and it sorts first because it was saved last.
  assert.equal(page.clips[0].note, "no video, still useful");
  assert.equal(page.clips[0].videoYoutubeId, null);
  assert.equal(page.clips[1].videoYoutubeId, "dQw4w9WgXcQ");
  assert.equal(page.clips[1].videoTitle, "The joined title");
});

test("the inbox filters by status and by platform", async () => {
  const a = await saveClip({ url: YT });
  await saveClip({ url: "https://www.instagram.com/reel/Cxyz/" });
  assert.ok(a.ok);
  await db.update(schema.clips).set({ status: "failed" }).where(eq(schema.clips.id, a.clip.id));

  assert.equal((await listClips({ status: "failed" })).total, 1);
  assert.equal((await listClips({ status: "unprocessed" })).total, 1);
  assert.equal((await listClips({ platform: "instagram" })).total, 1);
  assert.equal((await listClips({ status: "failed", platform: "instagram" })).total, 0);
});

test("getClip, getClipByUrl and the status counts agree with the rows", async () => {
  const saved = await saveClip({ url: YT, note: "n" });
  assert.ok(saved.ok);

  const byId = await getClip(saved.clip.id);
  assert.equal(byId?.url, saved.clip.url);
  // The canonical URL is what got stored, so that is what the lookup takes.
  assert.equal((await getClipByUrl(saved.clip.url))?.id, saved.clip.id);
  assert.equal(await getClip(999_999), null, "a missing id is null, not a throw");
  assert.equal(await getClipByUrl("https://example.com/nope"), null);

  assert.deepEqual(await clipCountsByStatus(), { unprocessed: 1 });
});
