import assert from "node:assert/strict";
import { test } from "node:test";
import { outputFolders } from "./output-folders";

test("failed runs can recover stored output folders without markers, scoped to the stored brief", () => {
  assert.deepEqual(
    outputFolders({
      kind: "post",
      targetRef: "post:8",
      outputPaths: [],
      prompt:
        '```json\n{"folder":"guide/_brand/2026-10/8-copy","visuals":[{"targetFile":"guide/_brand/2026-10/8-copy/01.png"}]}\n```',
    }),
    ["guide/_brand/2026-10/8-copy"],
  );
  assert.deepEqual(
    outputFolders({
      kind: "script_thumbnails",
      targetRef: "script:8",
      outputPaths: [],
      prompt:
        '```json\n{"mediaDir":"media/8/thumbnails","variants":["media/8/thumbnails/1.png"]}\n```',
    }),
    ["8/thumbnails"],
  );
  assert.deepEqual(
    outputFolders({
      kind: "voice",
      targetRef: "voice:8",
      outputPaths: [],
      prompt: '```json\n{"lines":[{"outFile":"voice/free/owner/a/en/take-4.hf.mp3"}]}\n```',
    }),
    ["voice/free/owner/a/en"],
  );
  assert.deepEqual(
    outputFolders({
      kind: "free",
      targetRef: null,
      outputPaths: [],
      prompt: '```json\n{"folder":"../escape"}\n```',
    }),
    [],
  );
  assert.deepEqual(
    outputFolders({ kind: "import", targetRef: null, outputPaths: [], prompt: "last 5" }),
    ["_inbox/higgsfield"],
  );
});
