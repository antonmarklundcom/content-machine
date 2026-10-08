/**
 * Render a studio script to video (build 4 §3.B): MP4 + SRT + VTT under
 * MEDIA_ROOT/renders/script/script-<id>/<lang>/, registered as assets, with a
 * `video_renders` row. Waits for the render to finish.
 *
 *   npx tsx --conditions=react-server scripts/video-render.ts --script 12 --lang es-PY --format 16x9 [--burn] [--music path.mp3] [--music-db -18]
 *
 * (`npm run video:render -- …` once the script line is in package.json — see docs/log/b4-b.md.)
 *
 * Needs ffmpeg + ffprobe (FFMPEG_PATH / FFPROBE_PATH or PATH) and a selected
 * take for every spoken block of the script (owner_ref `script:<id>`, scene
 * refs `hook`, `s01`…, `cta`). Exit 0 on success, 1 on a refusal or failure.
 */

import path from "node:path";

import { closeDb } from "../src/db";
import { renderVideo, VIDEO_FORMATS, type VideoFormat } from "../src/lib/video";
import { buildScriptRenderRequest } from "../src/lib/video/from-script";
import { formatDuration } from "../src/lib/video/view";
import { VOICE_LANGUAGES, type VoiceLanguage } from "../src/lib/voice/contract";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<number> {
  const scriptId = Number(arg("--script"));
  const language = (arg("--lang") ?? "es-PY") as VoiceLanguage;
  const format = (arg("--format") ?? "16x9") as VideoFormat;
  const music = arg("--music");
  const musicDb = arg("--music-db");
  if (!Number.isSafeInteger(scriptId) || scriptId <= 0) {
    console.error(
      "Usage: video-render --script <id> --lang es-PY --format 16x9 [--burn] [--music file] [--music-db -18]",
    );
    return 1;
  }
  if (!VOICE_LANGUAGES.includes(language)) {
    console.error(`--lang must be one of ${VOICE_LANGUAGES.join(", ")}`);
    return 1;
  }
  if (!VIDEO_FORMATS.includes(format)) {
    console.error(`--format must be one of ${VIDEO_FORMATS.join(", ")}`);
    return 1;
  }

  const req = await buildScriptRenderRequest({
    scriptId,
    language,
    format,
    burnCaptions: process.argv.includes("--burn"),
    musicPath: music ? path.resolve(music) : null,
    musicDb: musicDb !== undefined ? Number(musicDb) : undefined,
  });
  console.log(
    `Rendering script ${scriptId} (${language}, ${format}), ${req.scenes.length} scene(s)…`,
  );
  const result = await renderVideo(req);
  console.log(`Render #${result.renderId} done, ${formatDuration(result.durationMs)}:`);
  console.log(`  ${result.videoPath}\n  ${result.srtPath}\n  ${result.vttPath}`);
  return 0;
}

main()
  .then(async (code) => {
    await closeDb();
    process.exit(code);
  })
  .catch(async (err) => {
    console.error(err instanceof Error ? err.message : err);
    await closeDb().catch(() => {});
    process.exit(1);
  });
