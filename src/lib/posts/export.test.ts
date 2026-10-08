import assert from "node:assert/strict";
import { test } from "node:test";

import type { BrandKit } from "@/db/schema";

import {
  aspectRatioFor,
  briefMarkdown,
  buildBrief,
  buildPack,
  captionText,
  packMarkdown,
} from "./export";
import { sampleCarouselDraft, sampleReelDraft } from "./fixture";

const POST = {
  id: 7,
  brandId: "guide",
  handle: "Guide.EN",
  platform: "instagram",
  title: "Moving checklist",
  scheduledFor: null,
  createdAt: new Date("2026-09-03T10:00:00Z"),
};

test("the caption as posted ends with the hashtags", () => {
  assert.equal(captionText({ caption: " Hi ", hashtags: ["a", "b"] }), "Hi\n\n#a #b");
  assert.equal(captionText({ caption: "Hi", hashtags: [] }), "Hi");
});

test("a carousel brief: one visual per slide in the post's folder, the cover first, the kit attached", () => {
  const kit = {
    higgsfield: { elementIds: ["e1"], characterIds: ["c1"], styleNotes: "Film" },
    colors: [{ name: "Red", hex: "#f00" }],
    logoAssetId: 3,
  } as BrandKit;
  const brief = buildBrief(POST, sampleCarouselDraft(), kit);
  assert.equal(brief.folder, "guide/guide-en/2026-09/7-moving-checklist");
  assert.deepEqual(
    brief.visuals.map((v) => [v.n, v.role, v.targetFile]),
    [
      [1, "cover", "guide/guide-en/2026-09/7-moving-checklist/01-nobody-tells-you-this.png"],
      [2, "slide", "guide/guide-en/2026-09/7-moving-checklist/02-residency-takes-months.png"],
    ],
  );
  assert.deepEqual(brief.kit?.higgsfieldCharacterIds, ["c1"]);
  const md = briefMarkdown(brief);
  assert.match(md, /Higgsfield elements: e1/);
  assert.match(md, /```json/);
});

test("a reel brief has a still and a clip per shot, vertical", () => {
  const brief = buildBrief({ ...POST, handle: null }, sampleReelDraft(), null);
  assert.equal(brief.folder.split("/")[1], "_brand");
  assert.equal(brief.visuals[0].aspectRatio, "9:16");
  assert.match(brief.visuals[0].targetVideoFile ?? "", /01-sabias-esto\.mp4$/);
  assert.equal(brief.kit, null);
});

test("aspect ratios per format and platform", () => {
  assert.equal(aspectRatioFor("carousel", "instagram"), "4:5");
  assert.equal(aspectRatioFor("image_post", "facebook"), "1:1");
  assert.equal(aspectRatioFor("video", "youtube"), "16:9");
  assert.equal(aspectRatioFor("story", "instagram"), "9:16");
});

test("the pack keeps the stored caption and the files' order", () => {
  const asset = {
    id: 5,
    kind: "image",
    mime: "image/png",
    publicUrl: null,
    localPath: "guide/x/01-a.png",
    altText: "Alt",
  } as never;
  const pack = buildPack(
    { ...POST, caption: "Edited caption", firstComment: null },
    sampleCarouselDraft(),
    [{ position: 1, role: "cover", asset }],
  );
  assert.equal(pack.caption, "Edited caption");
  assert.equal(pack.firstComment, "Sources in the second slide's caption.");
  assert.deepEqual(pack.files[0], {
    position: 1,
    role: "cover",
    assetId: 5,
    kind: "image",
    mime: "image/png",
    url: "/api/media/asset/5",
    publicUrl: null,
    fileName: "01-a.png",
    altText: "Alt",
  });
  assert.match(packMarkdown(pack), /1\. 01-a\.png \(cover\)/);
});
