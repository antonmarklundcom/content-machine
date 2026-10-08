import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import sharp from "sharp";

import { db, schema } from "@/db";
import { GET as renderStatus } from "@/app/api/video/renders/[id]/route";
import { createScript } from "@/lib/bridge/scripts";
import { registerFile } from "@/lib/media/register";
import { sniffMime } from "@/lib/media/sniff";
import { validateScriptBody } from "@/lib/scripts/contract";
import { sampleScriptBody } from "@/lib/scripts/fixture";
import { renderVideo, type RenderRequest, type RenderScene } from "@/lib/video";
import { buildScriptRenderRequest, ScriptRenderRefusedError } from "@/lib/video/from-script";
import type { RenderPlan } from "@/lib/video/render";

import { callRoute, signIn } from "./route";
import { resetTables, teardown } from "./setup";

/**
 * Phase B exit (PLAN-build4 §3.B): two generated stills and two sine WAVs
 * render to 16:9 and 9:16; the MP4's ffprobe duration matches the timeline
 * (±150 ms); SRT/VTT are written; `video_renders` and `assets` rows say so.
 * Skipped, with a message, when ffmpeg/ffprobe are not installed.
 */

const ffmpeg = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
const ffprobe = process.env.FFPROBE_PATH?.trim() || "ffprobe";
const haveTools =
  spawnSync(ffmpeg, ["-version"]).status === 0 && spawnSync(ffprobe, ["-version"]).status === 0;
const hasLibass =
  haveTools &&
  /^\s*\S+\s+subtitles\s/m.test(
    spawnSync(ffmpeg, ["-hide_banner", "-filters"], { encoding: "utf8" }).stdout ?? "",
  );
const skip = haveTools ? false : "ffmpeg/ffprobe not installed — skipping the render tests";
if (skip) console.log(`# ${skip}`);

let root = "";
const saved: Record<string, string | undefined> = {};
const files = { portrait: "", landscape: "", a1: "", a2: "", music: "" };

function probeMs(file: string): number {
  const out = execFileSync(ffprobe, [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    file,
  ]).toString();
  return Math.round(Number.parseFloat(out) * 1000);
}

function probeStream(file: string): { width: number; height: number; codec: string } {
  const out = execFileSync(ffprobe, [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height,codec_name",
    "-of",
    "json",
    file,
  ]).toString();
  const s = JSON.parse(out).streams[0];
  return { width: s.width, height: s.height, codec: s.codec_name };
}

function sine(file: string, seconds: number, freq: number): void {
  execFileSync(ffmpeg, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=${freq}:duration=${seconds}:sample_rate=48000`,
    file,
  ]);
}

before(async () => {
  if (skip) return;
  for (const key of ["MEDIA_ROOT", "VIDEO_X264_PRESET"]) saved[key] = process.env[key];
  root = mkdtempSync(path.join(tmpdir(), "b4b-media-"));
  process.env.MEDIA_ROOT = root;
  process.env.VIDEO_X264_PRESET = "ultrafast";
  const src = path.join(root, "src");
  mkdirSync(src, { recursive: true });
  files.portrait = path.join(src, "portrait.png");
  files.landscape = path.join(src, "landscape.jpg");
  // 4:5 portrait art and a landscape still, each with a distinct shape so a crop would show.
  await sharp({ create: { width: 400, height: 500, channels: 3, background: "#e11d48" } })
    .composite([
      {
        input: Buffer.from(
          '<svg width="400" height="500"><circle cx="200" cy="250" r="150" fill="#fde047"/></svg>',
        ),
      },
    ])
    .png()
    .toFile(files.portrait);
  await sharp({ create: { width: 640, height: 360, channels: 3, background: "#0f766e" } })
    .jpeg()
    .toFile(files.landscape);
  files.a1 = path.join(src, "a1.wav");
  files.a2 = path.join(src, "a2.wav");
  files.music = path.join(src, "music.wav");
  sine(files.a1, 1.5, 440);
  sine(files.a2, 2.2, 660);
  sine(files.music, 1.0, 220);
});

beforeEach(resetTables);

after(async () => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (root) rmSync(root, { recursive: true, force: true });
  await teardown();
});

function scenes(): RenderScene[] {
  return [
    {
      sceneRef: "S01",
      visualPath: files.portrait,
      visualKind: "image",
      audioPath: files.a1,
      audioDurationMs: 1500,
      captionText: "Había una vez un sapito. Se llamaba Tito.",
      alignment: [
        { word: "Había", startMs: 0, endMs: 200 },
        { word: "una", startMs: 200, endMs: 300 },
        { word: "vez", startMs: 300, endMs: 450 },
        { word: "un", startMs: 450, endMs: 520 },
        { word: "sapito.", startMs: 520, endMs: 800 },
        { word: "Se", startMs: 900, endMs: 1000 },
        { word: "llamaba", startMs: 1000, endMs: 1250 },
        { word: "Tito.", startMs: 1250, endMs: 1500 },
      ],
    },
    {
      sceneRef: "S02",
      visualPath: files.landscape,
      visualKind: "image",
      audioPath: files.a2,
      audioDurationMs: 2200,
      padAfterMs: 900,
      captionText: "Y saltaba muy alto, ¡hasta las nubes!",
      camera: "pan_left",
    },
  ];
}

function request(
  format: RenderRequest["format"],
  extra: Partial<RenderRequest> = {},
): RenderRequest {
  return {
    ownerKind: "story",
    ownerRef: "story:tito-salto-chiquito",
    language: "es-PY",
    format,
    scenes: scenes(),
    outFolder: `stories/tito-salto-chiquito/video/es-py`,
    outName: `tito-es-PY-${format}`,
    ...extra,
  };
}

async function checkRender(
  result: Awaited<ReturnType<typeof renderVideo>>,
  expected: { totalMs: number; width: number; height: number },
) {
  const mp4 = path.join(root, ...result.videoPath.split("/"));
  assert.ok(existsSync(mp4), "MP4 written under MEDIA_ROOT");
  const measured = probeMs(mp4);
  assert.ok(
    Math.abs(measured - expected.totalMs) <= 150,
    `ffprobe ${measured} ms ≈ timeline ${expected.totalMs} ms`,
  );
  const stream = probeStream(mp4);
  assert.deepEqual(stream, { width: expected.width, height: expected.height, codec: "h264" });

  const srt = readFileSync(path.join(root, ...result.srtPath.split("/")), "utf8");
  const vtt = readFileSync(path.join(root, ...result.vttPath.split("/")), "utf8");
  assert.ok(srt.startsWith("1\n00:00:00,000 --> "), srt);
  assert.ok(srt.includes("Había una vez un sapito."));
  assert.ok(srt.includes("00:00:02,100 --> "), "scene 2 cues start at the scene start");
  assert.ok(vtt.startsWith("WEBVTT\n\n1\n00:00:00.000 --> "));

  const [row] = await db
    .select()
    .from(schema.videoRenders)
    .where(eq(schema.videoRenders.id, result.renderId));
  assert.equal(row.status, "done");
  assert.equal(row.error, null);
  assert.ok(row.startedAt && row.finishedAt);
  assert.equal(row.durationMs, result.durationMs);
  const plan = row.plan as RenderPlan;
  assert.equal(plan.timeline?.totalMs, expected.totalMs);
  assert.ok(plan.cues && plan.cues.length >= 3);
  assert.deepEqual(plan.cameras?.slice(0, 2), ["zoom_in", "pan_left"]);

  const rows = await db
    .select()
    .from(schema.assets)
    .where(inArray(schema.assets.id, [row.outputAssetId!, row.srtAssetId!, row.vttAssetId!]));
  const byId = new Map(rows.map((a) => [a.id, a]));
  assert.equal(byId.get(row.outputAssetId!)?.kind, "video");
  const video = byId.get(row.outputAssetId!);
  assert.ok(video?.localPath);
  const videoBytes = readFileSync(mp4);
  const videoSha = createHash("sha256").update(videoBytes).digest("hex");
  assert.equal(video.localPath, `_originals/${videoSha.slice(0, 2)}/${videoSha}.mp4`);
  assert.equal(video.sha256, videoSha);
  assert.equal(video.bytes, videoBytes.length);
  assert.equal(video.sourceRef, `render:${row.id}`);
  assert.deepEqual(sniffMime(videoBytes), { kind: "video", mime: "video/mp4", ext: "mp4" });
  assert.deepEqual(readFileSync(path.join(root, ...video.localPath.split("/"))), videoBytes);
  assert.equal(byId.get(row.srtAssetId!)?.mime, "application/x-subrip");
  assert.equal(byId.get(row.vttAssetId!)?.mime, "text/vtt");
  assert.equal(byId.get(row.vttAssetId!)?.localPath, result.vttPath);
  assert.equal(byId.get(row.srtAssetId!)?.localPath, result.srtPath);
  for (const [assetId, file] of [
    [row.srtAssetId!, result.srtPath],
    [row.vttAssetId!, result.vttPath],
  ] as const) {
    const asset = byId.get(assetId);
    assert.ok(asset);
    const bytes = readFileSync(path.join(root, ...file.split("/")));
    assert.equal(asset.kind, "document");
    assert.equal(asset.sha256, createHash("sha256").update(bytes).digest("hex"));
    assert.equal(asset.bytes, bytes.length);
    assert.equal(asset.sourceRef, `render:${row.id}`);
    assert.ok(asset.tags.includes("captions"));
  }
  return row;
}

test("renders 16:9 with soft captions: duration, files and rows", { skip }, async () => {
  const result = await renderVideo(request("16x9"));
  // 1500 + 600, then 2200 + 900.
  assert.ok(result.videoPath.endsWith(`tito-es-PY-16x9-r${result.renderId}.mp4`));
  await checkRender(result, { totalMs: 5200, width: 1920, height: 1080 });
  const temps = readdirSync(tmpdir()).filter((n) => n.startsWith("ce-render-"));
  assert.equal(temps.length, 0, "temp dirs cleaned up");
});

test(
  "renders 9:16 with a ducked music bed (and burned captions when libass is there)",
  { skip },
  async () => {
    const result = await renderVideo(
      request("9x16", { musicPath: files.music, musicDb: -20, burnCaptions: hasLibass }),
    );
    await checkRender(result, { totalMs: 5200, width: 1080, height: 1920 });

    // The status route the poller reads.
    const { cookie } = await signIn("owner");
    const res = await callRoute(
      (req) => renderStatus(req, { params: Promise.resolve({ id: String(result.renderId) }) }),
      new Request(`http://localhost/api/video/renders/${result.renderId}`, { headers: { cookie } }),
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, "done");
    assert.match(body.videoUrl, /^\/api\/media\/asset\/\d+$/);
    assert.equal(body.burned, hasLibass);
  },
);

test("a missing visual fails the row with a clear error", { skip }, async () => {
  const req = request("1x1");
  req.scenes[1].visualPath = path.join(root, "src", "nope.png");
  await assert.rejects(renderVideo(req), /S02: visual not found/);
  const [row] = await db.select().from(schema.videoRenders);
  assert.equal(row.status, "failed");
  assert.match(row.error ?? "", /S02: visual not found/);
});

test(
  "script → video: refuses missing takes, then renders over b-roll and title cards",
  { skip },
  async () => {
    const script = await createScript(
      { brandId: "guide", title: "Residency", language: "es-PY", body: sampleScriptBody() },
      validateScriptBody,
    );
    await assert.rejects(
      buildScriptRenderRequest({ scriptId: script.id, language: "es-PY", format: "16x9" }),
      (err: unknown) =>
        err instanceof ScriptRenderRefusedError &&
        err.missing.join(",") === "hook,s01,cta" &&
        /hook \(Hook\), s01 \(The real timeline\), cta \(CTA\)/.test(err.message),
    );

    // Takes: the WAVs live under voice/… like phase A's masters.
    const voiceDir = path.join(root, "voice", "script", `script-${script.id}`);
    mkdirSync(voiceDir, { recursive: true });
    const takeFiles: Record<string, { file: string; ms: number }> = {
      hook: { file: path.join(voiceDir, "hook.wav"), ms: 1200 },
      s01: { file: path.join(voiceDir, "s01.wav"), ms: 1400 },
      cta: { file: path.join(voiceDir, "cta.wav"), ms: 1000 },
    };
    let freq = 300;
    for (const [sceneRef, t] of Object.entries(takeFiles)) {
      sine(t.file, t.ms / 1000, (freq += 50));
      const reg = await registerFile(t.file, { brandId: "guide" });
      assert.ok(reg.status === "created");
      await db.insert(schema.narrations).values({
        ownerKind: "script",
        ownerRef: `script:${script.id}`,
        sceneRef,
        language: "es-PY",
        inputText: `Texto de ${sceneRef}.`,
        textHash: "0".repeat(64),
        provider: "manual",
        status: "done",
        masterAssetId: reg.asset.id,
        durationMs: t.ms,
        selected: true,
      });
    }
    // The hook's b-roll still is in media/<id>/ under its shot number.
    mkdirSync(path.join(root, String(script.id)), { recursive: true });
    await sharp({ create: { width: 320, height: 180, channels: 3, background: "#1d4ed8" } })
      .png()
      .toFile(path.join(root, String(script.id), "01-calendar.png"));

    const req = await buildScriptRenderRequest({
      scriptId: script.id,
      language: "es-PY",
      format: "16x9",
    });
    assert.equal(req.outFolder, `renders/script/script-${script.id}/es-py`);
    assert.equal(req.brandId, "guide");
    assert.deepEqual(
      req.scenes.map((s) => s.sceneRef),
      ["hook", "s01", "cta"],
    );
    assert.ok(req.scenes[0].visualPath.endsWith("01-calendar.png"));
    assert.ok(req.scenes[1].visualPath.endsWith(path.join("cards", "s01-16x9.png")), "title card");
    assert.equal(req.scenes[2].captionText, "Texto de cta.");

    const result = await renderVideo(req);
    const total = 1200 + 1400 + 1000 + 3 * 600;
    assert.ok(Math.abs(probeMs(path.join(root, ...result.videoPath.split("/"))) - total) <= 150);
  },
);
