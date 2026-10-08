import type { CameraMove, VideoFormat } from "./contract";
import { FOREGROUND_FIT, zoompanExpressions } from "./camera";
import { FORMAT_SIZE, FPS } from "./timeline";

/**
 * ffmpeg argument and filtergraph builders (PLAN-build4 §3.B). Pure, so every
 * graph is unit-tested without running ffmpeg. The renderer runs each command
 * with its temp dir as the working directory, so file names inside a
 * filtergraph (the burned captions) are plain relative names and never need
 * Windows drive-letter escaping.
 */

export const AUDIO_RATE = 48_000;
/** Each still is composed this many times larger than the frame, so zoompan's whole-pixel crop moves in quarter pixels. */
export const UPSCALE = 4;
export const DEFAULT_MUSIC_DB = -18;
/** The music bed fades out over the last seconds. */
export const MUSIC_FADE_S = 2.5;

export type EncodeOptions = {
  /** x264 preset, default `medium`. Tests use `ultrafast`. */
  preset?: string;
  crf?: number;
};

const BASE = ["-hide_banner", "-nostdin", "-y", "-loglevel", "error"];

export function seconds(ms: number): string {
  return (Math.max(0, ms) / 1000).toFixed(3);
}

function even(n: number): number {
  return Math.max(2, Math.round(n / 2) * 2);
}

/** The box the whole art is fitted into, in frame pixels. */
export function foregroundBox(format: VideoFormat): { width: number; height: number } {
  const { width, height } = FORMAT_SIZE[format];
  return { width: even(width * FOREGROUND_FIT), height: even(height * FOREGROUND_FIT) };
}

function videoCodec(opts: EncodeOptions): string[] {
  return [
    "-c:v",
    "libx264",
    "-preset",
    opts.preset ?? "medium",
    "-crf",
    String(opts.crf ?? 18),
    "-pix_fmt",
    "yuv420p",
    "-r",
    String(FPS),
  ];
}

/**
 * The blurred, darkened background (cover-scaled, so it fills the frame) and
 * the whole art fitted inside the foreground box — at `scale`× the frame.
 * Blurred small and scaled up: cheap, and softer than a large-radius blur.
 */
function framingGraph(format: VideoFormat, scale: number, input: string): string[] {
  const { width: W, height: H } = FORMAT_SIZE[format];
  const fg = foregroundBox(format);
  const sw = even(W / 8);
  const sh = even(H / 8);
  return [
    `${input}split=2[bgsrc][fgsrc]`,
    `[bgsrc]scale=w=${sw}:h=${sh}:force_original_aspect_ratio=increase,crop=${sw}:${sh},boxblur=luma_radius=10:luma_power=3,eq=brightness=-0.22:saturation=0.75,scale=${W * scale}:${H * scale}:flags=bicubic,setsar=1[bg]`,
    `[fgsrc]scale=w=${fg.width * scale}:h=${fg.height * scale}:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos,setsar=1[fg]`,
  ];
}

/** Filtergraph for a still: framed at `UPSCALE`×, then zoompan down to the frame. */
export function stillFilterGraph(format: VideoFormat, camera: CameraMove, frames: number): string {
  const { width: W, height: H } = FORMAT_SIZE[format];
  const zp = zoompanExpressions(camera, frames);
  return [
    ...framingGraph(format, UPSCALE, "[0:v]"),
    `[bg][fg]overlay=x=(W-w)/2:y=(H-h)/2,zoompan=z='${zp.z}':x='${zp.x}':y='${zp.y}':d=${frames}:s=${W}x${H}:fps=${FPS},format=yuv420p,setsar=1[v]`,
  ].join(";");
}

/** Filtergraph for a video visual: looped by the input, framed the same way, cut to `frames`. */
export function clipFilterGraph(format: VideoFormat, frames: number): string {
  return [
    ...framingGraph(format, 1, `[0:v]fps=${FPS},`),
    `[bg][fg]overlay=x=(W-w)/2:y=(H-h)/2,format=yuv420p,setsar=1,trim=end_frame=${frames},setpts=PTS-STARTPTS[v]`,
  ].join(";");
}

/** One scene's silent video: a still (one input frame) or a looped clip, exactly `frames` long. */
export function sceneArgs(input: {
  visualPath: string;
  visualKind: "image" | "video";
  format: VideoFormat;
  camera: CameraMove;
  frames: number;
  outFile: string;
  encode?: EncodeOptions;
}): string[] {
  const inputArgs =
    input.visualKind === "video"
      ? ["-stream_loop", "-1", "-i", input.visualPath]
      : ["-i", input.visualPath];
  const graph =
    input.visualKind === "video"
      ? clipFilterGraph(input.format, input.frames)
      : stillFilterGraph(input.format, input.camera, input.frames);
  return [
    ...BASE,
    ...inputArgs,
    "-filter_complex",
    graph,
    "-map",
    "[v]",
    "-frames:v",
    String(input.frames),
    ...videoCodec(input.encode ?? {}),
    "-an",
    input.outFile,
  ];
}

export type AudioScene = { audioPath: string | null; durationMs: number };

/**
 * The soundtrack: each scene's narration padded with silence to exactly its
 * scene length (never stretched), concatenated; optionally a looped music bed
 * at `musicDb`, ducked under the narration with sidechaincompress and faded
 * out at the end. Written as PCM WAV; the final mux encodes AAC once.
 */
export function audioArgs(input: {
  scenes: AudioScene[];
  totalMs: number;
  musicPath?: string | null;
  musicDb?: number;
  outFile: string;
}): string[] {
  const args = [...BASE];
  const graph: string[] = [];
  const fmt = `aresample=${AUDIO_RATE},aformat=sample_fmts=fltp:channel_layouts=stereo`;
  input.scenes.forEach((scene, i) => {
    if (scene.audioPath) {
      args.push("-i", scene.audioPath);
    } else {
      args.push(
        "-f",
        "lavfi",
        "-t",
        seconds(scene.durationMs),
        "-i",
        `anullsrc=r=${AUDIO_RATE}:cl=stereo`,
      );
    }
    graph.push(
      `[${i}:a]${fmt},apad,atrim=end=${seconds(scene.durationMs)},asetpts=PTS-STARTPTS[a${i}]`,
    );
  });
  const labels = input.scenes.map((_, i) => `[a${i}]`).join("");
  graph.push(`${labels}concat=n=${input.scenes.length}:v=0:a=1[narr]`);

  let out = "[narr]";
  if (input.musicPath) {
    const m = input.scenes.length;
    args.push("-stream_loop", "-1", "-i", input.musicPath);
    const total = Math.max(0, input.totalMs) / 1000;
    const fade = Math.min(MUSIC_FADE_S, total / 2);
    const db = input.musicDb ?? DEFAULT_MUSIC_DB;
    graph.push(
      `[narr]asplit=2[voice][key]`,
      `[${m}:a]${fmt},atrim=end=${total.toFixed(3)},asetpts=PTS-STARTPTS,volume=${db}dB[bed]`,
      `[bed][key]sidechaincompress=threshold=0.03:ratio=6:attack=20:release=400[ducked]`,
      `[ducked]afade=t=out:st=${(total - fade).toFixed(3)}:d=${fade.toFixed(3)}[bedout]`,
      `[voice][bedout]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[mix]`,
    );
    out = "[mix]";
  }
  args.push(
    "-filter_complex",
    graph.join(";"),
    "-map",
    out,
    "-t",
    seconds(input.totalMs),
    "-c:a",
    "pcm_s16le",
    "-ar",
    String(AUDIO_RATE),
    input.outFile,
  );
  return args;
}

/** The concat demuxer's list: one `file '<name>'` per scene, quotes escaped. */
export function concatList(files: string[]): string {
  return files.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n") + "\n";
}

/** libass style for burned captions, sized per format (SRT's 288-line play area). */
export function subtitleStyle(format: VideoFormat): string {
  const size = format === "9x16" ? 10 : format === "1x1" ? 13 : 16;
  const margin = format === "9x16" ? 40 : 18;
  return [
    "FontName=DejaVu Sans",
    `FontSize=${size}`,
    "PrimaryColour=&H00FFFFFF",
    "OutlineColour=&H00000000",
    "BorderStyle=1",
    "Outline=1.5",
    "Shadow=0",
    `MarginV=${margin}`,
  ].join(",");
}

/**
 * The final file: the concatenated scenes plus the soundtrack, AAC 192 kbps,
 * `+faststart`. Video is copied as is, unless captions are burned in, which
 * re-encodes once through the `subtitles` filter (`srtName` relative to the
 * working directory).
 */
export function muxArgs(input: {
  listFile: string;
  audioFile: string;
  totalMs: number;
  outFile: string;
  format: VideoFormat;
  burnSrt?: string | null;
  encode?: EncodeOptions;
}): string[] {
  const video = input.burnSrt
    ? [
        "-vf",
        `subtitles=filename=${input.burnSrt}:force_style='${subtitleStyle(input.format)}'`,
        ...videoCodec(input.encode ?? {}),
      ]
    : ["-c:v", "copy"];
  return [
    ...BASE,
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    input.listFile,
    "-i",
    input.audioFile,
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    ...video,
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-ar",
    String(AUDIO_RATE),
    "-movflags",
    "+faststart",
    "-t",
    seconds(input.totalMs),
    input.outFile,
  ];
}

/** ffprobe: the container duration in seconds on one line. */
export function probeDurationArgs(file: string): string[] {
  return [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    file,
  ];
}
