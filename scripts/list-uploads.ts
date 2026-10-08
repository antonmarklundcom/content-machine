/**
 * PR-04 done-when: "scripts/ can list a channel's uploads".
 *
 *   export YOUTUBE_API_KEY='...'
 *   npx tsx scripts/list-uploads.ts 'https://www.youtube.com/@SomeChannel'
 *   npx tsx scripts/list-uploads.ts 'https://www.youtube.com/playlist?list=PL...' --limit 20
 *
 * Accepts any YouTube URL form — video, playlist, channel, @handle, /c/, /user/.
 * Prints the quota cost of the run, because staying inside the free 10,000
 * units/day is a design constraint, not an afterthought (src/lib/youtube/quota.ts).
 */

import { YouTubeDataClient } from "../src/lib/youtube/data-api";
import { QuotaExhaustedError } from "../src/lib/youtube/quota";
import { describeRef, parseYouTubeUrl } from "../src/lib/youtube/url";

const DEFAULT_LIMIT = 25;

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const limitFlag = argv.indexOf("--limit");
  const limit = limitFlag !== -1 ? Number(argv[limitFlag + 1]) || DEFAULT_LIMIT : DEFAULT_LIMIT;
  const input = argv.find((a) => !a.startsWith("--") && a !== String(limit));

  if (!input) {
    console.error("Usage: npx tsx scripts/list-uploads.ts <youtube-url> [--limit N]");
    process.exit(2);
  }

  const ref = parseYouTubeUrl(input);
  if (!ref) {
    console.error(`Could not parse a YouTube reference from: ${input}`);
    process.exit(2);
  }
  console.log(`Parsed as ${describeRef(ref)}`);

  const client = new YouTubeDataClient();
  const resolved = await client.resolve(ref);
  if (!resolved) {
    console.error("YouTube returned no such entity (deleted, private, or wrong id).");
    process.exit(1);
  }

  let videoIds: string[];

  switch (resolved.kind) {
    case "video": {
      printVideos([resolved.video]);
      report(client);
      return;
    }
    case "channel": {
      const { channel } = resolved;
      console.log(`Channel: ${channel.title}${channel.handle ? ` (@${channel.handle})` : ""}`);
      console.log(`Uploads playlist: ${channel.uploadsPlaylistId ?? "none"}`);
      const uploads = await client.listChannelUploads(channel.channelId, { limit });
      videoIds = uploads.videoIds;
      break;
    }
    case "playlist": {
      const { playlist } = resolved;
      console.log(
        `Playlist: ${playlist.title}` +
          (playlist.channelTitle ? ` — ${playlist.channelTitle}` : "") +
          (playlist.itemCount !== null ? ` (${playlist.itemCount} items)` : ""),
      );
      videoIds = await client.listPlaylistVideoIds(playlist.playlistId, { limit });
      break;
    }
  }

  console.log(`\nFound ${videoIds.length} video id(s) (limit ${limit}). Fetching metadata…\n`);
  printVideos(await client.getVideos(videoIds));
  report(client);
}

function printVideos(videos: Array<import("../src/lib/youtube/data-api").VideoMetadata>): void {
  for (const v of videos) {
    const date = v.publishedAt ? v.publishedAt.toISOString().slice(0, 10) : "??????????";
    const dur = v.durationSeconds !== null ? formatDuration(v.durationSeconds) : "--:--";
    const views = v.viewCount !== null ? v.viewCount.toLocaleString("en-US") : "hidden";
    console.log(
      `  ${date}  ${dur.padStart(8)}  ${views.padStart(12)} views  ${v.isLive ? "[LIVE] " : ""}${v.title}`,
    );
    console.log(`            https://www.youtube.com/watch?v=${v.youtubeId}`);
  }
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

function report(client: YouTubeDataClient): void {
  console.log(`\nQuota: ${client.quota.summary()}`);
  console.log("For scale: the same listing via search.list would have cost 100 units per call.");
}

main().catch((err) => {
  if (err instanceof QuotaExhaustedError) {
    console.error(`\n${err.message}`);
    process.exit(3);
  }
  console.error("\nFailed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
