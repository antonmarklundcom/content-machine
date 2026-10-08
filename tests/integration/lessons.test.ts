import { insertReturning } from "@/db/mutations";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";

import { db, schema } from "@/db";
import {
  createLesson,
  deleteLesson,
  exportLessonsMarkdown,
  InvalidLessonError,
  listLessons,
} from "@/lib/bridge/lessons";

import { resetTables, teardown } from "./setup";

/** `bridge/lessons.ts` (PLAN.md §1.31, §5.O7.3): create, list, delete, export. */

beforeEach(resetTables);
after(teardown);

async function video() {
  const [row] = await insertReturning(db, schema.videos, {
    youtubeId: "abc123def45",
    title: "How residency works",
  });
  return row;
}

test("createLesson trims, defaults the kind, and validates", async () => {
  const lesson = await createLesson({ text: "  Open on the number people get wrong.  " });
  assert.equal(lesson.text, "Open on the number people get wrong.");
  assert.equal(lesson.kind, "lesson");
  assert.equal(lesson.brandId, null);

  const v = await video();
  const hook = await createLesson({
    text: "Contradict the number everyone repeats",
    kind: "hook",
    brandId: "residency",
    videoId: v.id,
    timestampSec: 12.7,
    sourceUrl: " ",
  });
  assert.equal(hook.timestampSec, 12, "whole seconds");
  assert.equal(hook.sourceUrl, null, "blank URL is no URL");

  await assert.rejects(createLesson({ text: "   " }), InvalidLessonError);
  await assert.rejects(createLesson({ text: "x", kind: "quote" as never }), InvalidLessonError);
});

test("listLessons filters by brand, kind, video and text, newest first", async () => {
  const v = await video();
  const first = await createLesson({ text: "Portfolio-wide 100% rule", kind: "lesson" });
  await createLesson({
    text: "Hook for residency",
    kind: "hook",
    brandId: "residency",
    videoId: v.id,
  });
  await createLesson({ text: "Fact for residency", kind: "fact", brandId: "residency" });
  await createLesson({ text: "Hook for pozo", kind: "hook", brandId: "pozo" });

  assert.equal((await listLessons()).length, 4);
  assert.equal((await listLessons())[0].text, "Hook for pozo", "newest first");
  assert.deepEqual((await listLessons({ brandId: "residency" })).map((l) => l.kind).sort(), [
    "fact",
    "hook",
  ]);
  assert.deepEqual(
    (await listLessons({ brandId: null })).map((l) => l.id),
    [first.id],
    "null = unbranded only",
  );
  assert.equal((await listLessons({ kind: "hook" })).length, 2);

  const fromVideo = await listLessons({ videoId: v.id });
  assert.equal(fromVideo.length, 1);
  assert.equal(fromVideo[0].videoYoutubeId, "abc123def45");
  assert.equal(fromVideo[0].videoTitle, "How residency works");

  assert.equal((await listLessons({ search: "HOOK" })).length, 2, "case-insensitive");
  assert.equal((await listLessons({ search: "100%" })).length, 1, "% is literal, not a wildcard");
  assert.equal((await listLessons({ search: "%" })).length, 1);
  assert.equal((await listLessons({ limit: 1 })).length, 1);
});

test("deleteLesson removes one row and reports whether it existed", async () => {
  const lesson = await createLesson({ text: "gone soon" });
  await createLesson({ text: "stays" });
  assert.equal(await deleteLesson(lesson.id), true);
  assert.equal(await deleteLesson(lesson.id), false);
  assert.deepEqual(
    (await listLessons()).map((l) => l.text),
    ["stays"],
  );
});

test("exportLessonsMarkdown groups by kind and links provenance", async () => {
  const v = await video();
  await createLesson({
    text: "Fact one",
    kind: "fact",
    brandId: "residency",
    sourceUrl: "https://example.com/a",
  });
  await createLesson({
    text: "Hook one\nsecond line",
    kind: "hook",
    brandId: "residency",
    videoId: v.id,
    timestampSec: 125,
  });
  await createLesson({ text: "Other brand", kind: "hook", brandId: "pozo" });

  const md = await exportLessonsMarkdown({ brandId: "residency" });
  assert.match(md, /^# Lessons — residency\n/);
  assert.ok(md.indexOf("## Hooks") < md.indexOf("## Facts"), "kinds in their fixed order");
  assert.ok(!md.includes("## Lessons\n"), "empty kinds are left out");
  assert.ok(
    md.includes(
      "- Hook one\n  second line — [How residency works @ 2:05](https://www.youtube.com/watch?v=abc123def45&t=125s)",
    ),
  );
  assert.ok(md.includes("- Fact one — <https://example.com/a>"));
  assert.ok(!md.includes("Other brand"));

  const hooksOnly = await exportLessonsMarkdown({ kind: "hook" });
  assert.ok(hooksOnly.includes("Other brand") && !hooksOnly.includes("Fact one"));

  assert.match(await exportLessonsMarkdown({ brandId: "nobody" }), /No lessons saved yet/);
});
