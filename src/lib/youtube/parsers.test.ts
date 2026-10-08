/**
 * Parser tests. Run with `npm test`.
 *
 * Uses node:test rather than a framework — these are pure functions with no
 * fixtures, and PLAN.md §6 forbids adding dependencies that do not earn
 * themselves. The two functions covered here are the ones where a silent bug is
 * expensive: a URL that parses to the wrong kind sends a channel down the video
 * path, and a bad duration is stored forever on an append-only row.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { parseIso8601Duration } from "./data-api";
import { parseVideoId, parseYouTubeUrl } from "./url";

test("parseIso8601Duration handles the forms YouTube actually returns", () => {
  assert.equal(parseIso8601Duration("PT14M32S"), 872);
  assert.equal(parseIso8601Duration("PT1H2M3S"), 3723);
  assert.equal(parseIso8601Duration("PT45S"), 45);
  assert.equal(parseIso8601Duration("PT2H"), 7200);
  assert.equal(parseIso8601Duration("P1DT2H"), 93_600);
  // Live streams report P0D — 0 is a real answer, not missing data, which is
  // why callers check isLive instead of treating 0 as unknown.
  assert.equal(parseIso8601Duration("P0D"), 0);
  assert.equal(parseIso8601Duration("garbage"), null);
  assert.equal(parseIso8601Duration(null), null);
});

test("parseYouTubeUrl resolves every URL form to the right kind", () => {
  const cases: Array<[string, string]> = [
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "video"],
    ["https://youtu.be/dQw4w9WgXcQ", "video"],
    ["https://www.youtube.com/shorts/dQw4w9WgXcQ", "video"],
    ["https://www.youtube.com/embed/dQw4w9WgXcQ", "video"],
    ["https://www.youtube.com/live/dQw4w9WgXcQ", "video"],
    ["https://m.youtube.com/watch?v=dQw4w9WgXcQ", "video"],
    ["dQw4w9WgXcQ", "video"],
    ["https://www.youtube.com/playlist?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf", "playlist"],
    ["https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw", "channel"],
    ["https://www.youtube.com/@veritasium", "channel_handle"],
    ["youtube.com/c/Vsauce", "channel_handle"],
    ["youtube.com/user/Vsauce", "channel_handle"],
    ["@mkbhd", "channel_handle"],
  ];
  for (const [input, kind] of cases) {
    assert.equal(parseYouTubeUrl(input)?.kind, kind, `${input} should parse as ${kind}`);
  }
});

test("a watch URL carrying ?list= resolves to the video, not the playlist", () => {
  // Pasting a video from inside a playlist is the common case, and treating it
  // as a playlist would silently ingest hundreds of unwanted videos.
  const ref = parseYouTubeUrl(
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf",
  );
  assert.deepEqual(ref, { kind: "video", videoId: "dQw4w9WgXcQ" });
});

test("non-YouTube hosts are rejected rather than coerced", () => {
  assert.equal(parseYouTubeUrl("https://example.com/watch?v=dQw4w9WgXcQ"), null);
  assert.equal(parseYouTubeUrl("https://vimeo.com/123456"), null);
  assert.equal(parseYouTubeUrl(""), null);
  assert.equal(parseYouTubeUrl("not a url"), null);
});

test("parseVideoId extracts an id from any video form", () => {
  assert.equal(parseVideoId("https://youtu.be/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(parseVideoId("dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(parseVideoId("https://www.youtube.com/@veritasium"), null);
});
