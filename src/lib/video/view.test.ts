import assert from "node:assert/strict";
import { test } from "node:test";

import type { VideoRender } from "@/db/schema";

import { formatDuration, isActive, renderView } from "./view";

test("formatDuration", () => {
  assert.equal(formatDuration(null), "—");
  assert.equal(formatDuration(5300), "0:05");
  assert.equal(formatDuration(125_400), "2:05");
  assert.equal(formatDuration(3_725_000), "1:02:05");
});

test("renderView links files through the asset route and reads burnCaptions from the plan", () => {
  const row: VideoRender = {
    id: 7,
    ownerKind: "script",
    ownerRef: "script:12",
    language: "es-PY",
    format: "16x9",
    status: "done",
    plan: { request: { burnCaptions: true } },
    outputAssetId: 10,
    srtAssetId: 11,
    vttAssetId: null,
    durationMs: 5300,
    error: null,
    startedAt: new Date("2026-10-07T10:00:00Z"),
    finishedAt: new Date("2026-10-07T10:01:00Z"),
    createdAt: new Date("2026-10-07T09:59:00Z"),
  };
  const v = renderView(row);
  assert.equal(v.videoUrl, "/api/media/asset/10");
  assert.equal(v.srtUrl, "/api/media/asset/11");
  assert.equal(v.vttUrl, null);
  assert.equal(v.burned, true);
  assert.equal(v.createdAt, "2026-10-07T09:59:00.000Z");
  assert.ok(isActive("queued") && isActive("rendering") && !isActive("done"));
});
