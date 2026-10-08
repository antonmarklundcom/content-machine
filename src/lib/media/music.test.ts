import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { isMusicFile, listMusicFiles, parseMusicDb, resolveMusicPath } from "./music";

const ffmpeg = spawnSync(process.env.FFMPEG_PATH || "ffmpeg", ["-version"]).status === 0;

test("resolveMusicPath keeps a choice inside MEDIA_ROOT", () => {
  const root = path.resolve("/media-root");
  assert.equal(resolveMusicPath("music/bed.mp3", root), path.join(root, "music", "bed.mp3"));
  assert.equal(
    resolveMusicPath("music\\sub\\bed.wav", root),
    path.join(root, "music", "sub", "bed.wav"),
  );
  for (const bad of [
    "",
    null,
    undefined,
    "../bed.mp3",
    "music/../../etc/bed.mp3",
    "/etc/bed.mp3",
    "\\\\server\\bed.mp3",
    "C:/bed.mp3",
    "music/bed.txt",
    "music/be\0d.mp3",
    "music/..",
  ]) {
    assert.equal(resolveMusicPath(bad, root), null, `refused: ${String(bad)}`);
  }
});

test("parseMusicDb clamps to -24 … -12 and defaults to -18", () => {
  assert.equal(parseMusicDb("-20"), -20);
  assert.equal(parseMusicDb(-40), -24);
  assert.equal(parseMusicDb("0"), -12);
  assert.equal(parseMusicDb("loud"), -18);
  assert.equal(parseMusicDb(undefined), -18);
  assert.ok(isMusicFile("A.MP3") && !isMusicFile("a.png"));
});

test("listMusicFiles lists audio under music/ with durations", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "music-"));
  try {
    assert.deepEqual(await listMusicFiles(root), [], "no music folder: empty");
    mkdirSync(path.join(root, "music", "calm"), { recursive: true });
    writeFileSync(path.join(root, "music", "notes.txt"), "x");
    writeFileSync(path.join(root, "music", ".hidden.mp3"), "x");
    const wav = path.join(root, "music", "calm", "sine.wav");
    if (ffmpeg) {
      spawnSync(process.env.FFMPEG_PATH || "ffmpeg", [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:duration=2",
        wav,
      ]);
    } else writeFileSync(wav, "not audio");
    const list = await listMusicFiles(root);
    assert.equal(list.length, 1);
    assert.equal(list[0].path, "music/calm/sine.wav");
    assert.equal(list[0].name, "calm/sine.wav");
    if (ffmpeg) assert.ok(Math.abs((list[0].durationSec ?? 0) - 2) < 0.1);
    assert.equal(resolveMusicPath(list[0].path, root), wav);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
