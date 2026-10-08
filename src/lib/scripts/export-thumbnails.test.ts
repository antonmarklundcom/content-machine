import assert from "node:assert/strict";
import { test } from "node:test";

import { EXPORT_FORMATS, THUMBNAIL_VARIANTS, thumbnailList, thumbnailListMarkdown } from "./export";
import { sampleScriptBody } from "./fixture";

const script = { id: 42, brandId: "propia", status: "draft", body: sampleScriptBody() };

test("format=thumbnails is an export format", () => {
  assert.ok((EXPORT_FORMATS as readonly string[]).includes("thumbnails"));
});

test("the thumbnail list numbers the three concepts, 16:9, two variants each under media/<id>/thumbnails/", () => {
  const list = thumbnailList(script);
  assert.equal(list.mediaDir, "media/42/thumbnails");
  assert.equal(list.variantsPerConcept, THUMBNAIL_VARIANTS);
  assert.deepEqual(
    list.thumbnails.map((t) => [t.number, t.aspectRatio, t.file, t.variants]),
    [
      [
        1,
        "16:9",
        "media/42/thumbnails/1.png",
        ["media/42/thumbnails/1.png", "media/42/thumbnails/1-2.png"],
      ],
      [
        2,
        "16:9",
        "media/42/thumbnails/2.png",
        ["media/42/thumbnails/2.png", "media/42/thumbnails/2-2.png"],
      ],
      [
        3,
        "16:9",
        "media/42/thumbnails/3.png",
        ["media/42/thumbnails/3.png", "media/42/thumbnails/3-2.png"],
      ],
    ],
  );
  assert.match(
    list.thumbnails[0].prompt,
    /^Paper calendar close-up\. 16:9 YouTube thumbnail.*text overlay reading "45 DAYS"/,
  );
  assert.match(
    list.thumbnails[1].prompt,
    /no text in the image/,
    "an empty overlay asks for no text",
  );
});

test("the Markdown carries each prompt, its overlay and files, and the same list as fenced JSON", () => {
  const list = thumbnailList(script);
  const md = thumbnailListMarkdown(list);
  assert.match(md, /^# Thumbnails — Paraguay residency in 45 days/);
  assert.match(md, /## 1\. Calendar, 90 crossed out\n\n- \*\*Text overlay:\*\* "45 DAYS"/);
  assert.match(md, /- \*\*Text overlay:\*\* _none_/);
  assert.match(md, /`media\/42\/thumbnails\/3-2\.png`/);
  const json = md.slice(md.indexOf("```json") + 7, md.lastIndexOf("```"));
  assert.deepEqual(JSON.parse(json), list);
});
