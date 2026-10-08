import assert from "node:assert/strict";
import { test } from "node:test";

import { sampleScriptBody } from "@/lib/scripts/fixture";
import {
  assemblePack,
  chaptersFromBody,
  cleanTags,
  formatTimestamp,
  normalizeYoutubeUrl,
  validatePublishPack,
  youtubeDescription,
} from "./pack";

test("timestamps are m:ss, then h:mm:ss", () => {
  assert.equal(formatTimestamp(0), "0:00");
  assert.equal(formatTimestamp(65.9), "1:05");
  assert.equal(formatTimestamp(3729), "1:02:09");
});

test("chapters start at 0:00 and each section starts after the words before it, at 150 wpm", () => {
  const b = sampleScriptBody();
  b.hook.spokenLines = [Array.from({ length: 75 }, () => "w").join(" ")]; // 30 s
  b.sections.push({ ...structuredClone(b.sections[0]!), heading: "Second" });
  b.sections[0]!.spokenLines = [Array.from({ length: 300 }, () => "w").join(" ")]; // 2 min
  assert.deepEqual(chaptersFromBody(b), [
    { time: "0:00", title: "Intro" },
    { time: "0:30", title: "The real timeline" },
    { time: "2:30", title: "Second" },
  ]);
});

test("tags lose #, duplicates and anything past 15", () => {
  const many = Array.from({ length: 20 }, (_, i) => `tag ${i}`);
  assert.deepEqual(cleanTags(["#Paraguay", "paraguay", " residency ", "", 3]), [
    "Paraguay",
    "residency",
  ]);
  assert.equal(cleanTags(many).length, 15);
});

test("the pack's description gets the script's sources; chapters are joined on when copied", () => {
  const b = sampleScriptBody();
  const pack = assemblePack(
    {
      description: "What you learn.\n\nSubscribe for more.",
      tags: ["a", "b"],
      pinnedComment: "Which step is slowest for you?",
      instagram: "IG",
      facebook: "FB",
      tiktok: "TT",
    },
    b,
    new Date("2026-09-26T10:00:00Z"),
  );
  assert.equal(
    pack.description,
    "What you learn.\n\nSubscribe for more.\n\nSources:\n- Migraciones: https://example.gov.py/migraciones/plazos",
  );
  assert.equal(pack.generatedAt, "2026-09-26T10:00:00.000Z");
  assert.match(
    youtubeDescription(pack),
    /Sources:[\s\S]*\n\n0:00 Intro\n0:\d\d The real timeline$/,
  );
});

test("a pack missing a part is refused, naming the part", () => {
  assert.throws(
    () =>
      assemblePack(
        {
          description: "x",
          tags: [],
          pinnedComment: "",
          instagram: "i",
          facebook: "f",
          tiktok: "t",
        },
        sampleScriptBody(),
      ),
    /left out: tags, pinned comment/,
  );
});

test("an edited pack is checked field by field", () => {
  const good = {
    description: "d",
    chapters: [{ time: " 0:00 ", title: " Intro " }],
    tags: ["#x", "y"],
    pinnedComment: "p",
    captions: { instagram: "i", facebook: "f", tiktok: "t" },
    generatedAt: "2026-09-26T10:00:00.000Z",
  };
  const ok = validatePublishPack(good);
  assert.ok(ok.ok);
  assert.deepEqual(ok.pack.chapters, [{ time: "0:00", title: "Intro" }]);
  assert.deepEqual(ok.pack.tags, ["x", "y"]);

  const bad = validatePublishPack({
    ...good,
    chapters: [{ time: "soon", title: "x" }],
    captions: null,
  });
  assert.equal(bad.ok, false);
  assert.deepEqual(!bad.ok && bad.errors, [
    "captions must be an object.",
    'chapters[0].time "soon" is not like 0:00 or 1:02:03.',
  ]);
  assert.equal(validatePublishPack("nope").ok, false);
});

test("only YouTube video URLs are accepted, normalised", () => {
  assert.equal(
    normalizeYoutubeUrl(" https://youtube.com/watch?v=abc123&t=4s "),
    "https://www.youtube.com/watch?v=abc123",
  );
  assert.equal(normalizeYoutubeUrl("https://youtu.be/abc123?si=x"), "https://youtu.be/abc123");
  assert.equal(
    normalizeYoutubeUrl("https://m.youtube.com/shorts/xyz_9"),
    "https://www.youtube.com/shorts/xyz_9",
  );
  assert.equal(normalizeYoutubeUrl("https://evil.example/watch?v=abc"), null);
  assert.equal(normalizeYoutubeUrl("javascript:alert(1)"), null);
  assert.equal(normalizeYoutubeUrl("https://www.youtube.com/"), null);
});
