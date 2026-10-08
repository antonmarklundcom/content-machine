import assert from "node:assert/strict";
import { test } from "node:test";

import {
  audioArgs,
  clipFilterGraph,
  concatList,
  foregroundBox,
  muxArgs,
  probeDurationArgs,
  sceneArgs,
  seconds,
  stillFilterGraph,
  subtitleStyle,
  UPSCALE,
} from "./ffmpeg-args";

function after(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

test("seconds() formats ms with millisecond precision", () => {
  assert.equal(seconds(2900), "2.900");
  assert.equal(seconds(-1), "0.000");
});

test("foreground box is 90% of the frame, even", () => {
  assert.deepEqual(foregroundBox("16x9"), { width: 1728, height: 972 });
  assert.deepEqual(foregroundBox("9x16"), { width: 972, height: 1728 });
});

test("still graph: blurred cover background, whole art fitted, upscaled zoompan to the frame", () => {
  const g = stillFilterGraph("16x9", "zoom_in", 87);
  assert.ok(g.includes("force_original_aspect_ratio=increase,crop="), "background covers");
  assert.ok(g.includes("boxblur="), "background blurred");
  assert.ok(g.includes("eq=brightness=-"), "background darkened");
  assert.ok(g.includes(`scale=${1920 * UPSCALE}:${1080 * UPSCALE}`), "composed upscaled");
  assert.ok(
    g.includes(`scale=w=${1728 * UPSCALE}:h=${972 * UPSCALE}:force_original_aspect_ratio=decrease`),
    "art fitted, never cropped",
  );
  assert.ok(g.includes("overlay=x=(W-w)/2:y=(H-h)/2"), "centred");
  assert.ok(g.includes(":d=87:s=1920x1080:fps=30"), "zoompan to the frame for the scene's frames");
  assert.ok(g.endsWith("format=yuv420p,setsar=1[v]"));
  // Expressions with commas are quoted so the filtergraph parser keeps them whole.
  assert.match(g, /zoompan=z='[^']+':x='[^']+':y='[^']+'/);
});

test("clip graph frames a video the same way and trims to the scene", () => {
  const g = clipFilterGraph("9x16", 45);
  assert.ok(g.startsWith("[0:v]fps=30,split=2"));
  assert.ok(g.includes("scale=1080:1920"));
  assert.ok(g.includes("trim=end_frame=45"));
  assert.ok(!g.includes("zoompan"));
});

test("scene args: still is one input frame, clip is looped; exact frames, H.264 yuv420p, no audio", () => {
  const still = sceneArgs({
    visualPath: "C:\\art\\p1.png",
    visualKind: "image",
    format: "1x1",
    camera: "pan_left",
    frames: 60,
    outFile: "scene-001.mp4",
    encode: { preset: "ultrafast" },
  });
  assert.equal(after(still, "-i"), "C:\\art\\p1.png");
  assert.ok(!still.includes("-loop") && !still.includes("-stream_loop"));
  assert.equal(after(still, "-frames:v"), "60");
  assert.equal(after(still, "-c:v"), "libx264");
  assert.equal(after(still, "-preset"), "ultrafast");
  assert.equal(after(still, "-pix_fmt"), "yuv420p");
  assert.equal(after(still, "-r"), "30");
  assert.ok(still.includes("-an"));
  assert.equal(still.at(-1), "scene-001.mp4");

  const clip = sceneArgs({
    visualPath: "/b.mp4",
    visualKind: "video",
    format: "16x9",
    camera: "zoom_in",
    frames: 30,
    outFile: "s.mp4",
  });
  assert.equal(after(clip, "-stream_loop"), "-1");
  assert.equal(after(clip, "-preset"), "medium");
});

test("audio args: narration padded to each scene length, silence for no audio, concat", () => {
  const args = audioArgs({
    scenes: [
      { audioPath: "/a.wav", durationMs: 2900 },
      { audioPath: null, durationMs: 1000 },
    ],
    totalMs: 3900,
    outFile: "audio.wav",
  });
  const graph = after(args, "-filter_complex")!;
  assert.ok(graph.includes("[0:a]aresample=48000"));
  assert.ok(graph.includes("apad,atrim=end=2.900"));
  assert.ok(graph.includes("[1:a]") && graph.includes("atrim=end=1.000"));
  assert.ok(graph.includes("[a0][a1]concat=n=2:v=0:a=1[narr]"));
  assert.ok(args.includes("anullsrc=r=48000:cl=stereo"));
  assert.equal(after(args, "-map"), "[narr]");
  assert.equal(args[args.lastIndexOf("-t") + 1], "3.900");
  assert.equal(after(args, "-c:a"), "pcm_s16le");
  assert.ok(!graph.includes("atempo"), "never time-stretched");
});

test("audio args with music: looped bed at musicDb, ducked by sidechaincompress, faded out", () => {
  const args = audioArgs({
    scenes: [{ audioPath: "/a.wav", durationMs: 10_000 }],
    totalMs: 10_000,
    musicPath: "/music.mp3",
    outFile: "audio.wav",
  });
  const graph = after(args, "-filter_complex")!;
  assert.equal(args[args.indexOf("/music.mp3") - 2], "-1", "music is looped");
  assert.ok(graph.includes("volume=-18dB"), "default -18 dB");
  assert.ok(graph.includes("[bed][key]sidechaincompress="));
  assert.ok(graph.includes("afade=t=out:st=7.500:d=2.500"));
  assert.ok(graph.includes("amix=inputs=2:duration=first"));
  assert.equal(after(args, "-map"), "[mix]");

  const quieter = audioArgs({
    scenes: [{ audioPath: "/a.wav", durationMs: 1000 }],
    totalMs: 1000,
    musicPath: "/m.mp3",
    musicDb: -24,
    outFile: "a.wav",
  });
  assert.ok(after(quieter, "-filter_complex")!.includes("volume=-24dB"));
});

test("concat list escapes quotes", () => {
  assert.equal(concatList(["a.mp4", "it's.mp4"]), "file 'a.mp4'\nfile 'it'\\''s.mp4'\n");
});

test("mux args: copy video, AAC 192k, faststart; burning re-encodes through subtitles", () => {
  const soft = muxArgs({
    listFile: "scenes.txt",
    audioFile: "audio.wav",
    totalMs: 5300,
    outFile: "out.mp4",
    format: "16x9",
  });
  assert.equal(after(soft, "-f"), "concat");
  assert.equal(after(soft, "-c:v"), "copy");
  assert.equal(after(soft, "-c:a"), "aac");
  assert.equal(after(soft, "-b:a"), "192k");
  assert.equal(after(soft, "-movflags"), "+faststart");
  assert.equal(after(soft, "-t"), "5.300");
  assert.ok(!soft.includes("-vf"));

  const burned = muxArgs({
    listFile: "scenes.txt",
    audioFile: "audio.wav",
    totalMs: 5300,
    outFile: "out.mp4",
    format: "9x16",
    burnSrt: "captions.srt",
  });
  const vf = after(burned, "-vf")!;
  assert.ok(vf.startsWith("subtitles=filename=captions.srt:force_style='"));
  assert.ok(vf.includes(subtitleStyle("9x16")));
  assert.equal(after(burned, "-c:v"), "libx264");
});

test("ffprobe duration args", () => {
  assert.deepEqual(probeDurationArgs("/x.mp4").slice(-1), ["/x.mp4"]);
  assert.ok(probeDurationArgs("/x.mp4").includes("format=duration"));
});
