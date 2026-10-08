/**
 * A stand-in for yt-dlp in S17's integration test (PLAN.md §6.S17): no
 * network, same argv contract. Writes `media.mp4` (a real `ftyp` header, so
 * O10's sniffer calls it a video) and `media.info.json` where `-o` points.
 *
 *   FAKE_YTDLP_LOG    append each argv (JSON, one line) to this file
 *   FAKE_YTDLP_MODE   "fail" → yt-dlp's ERROR line and exit 1;
 *                     "nothing" → exit 0 without writing (the --max-filesize skip)
 *   FAKE_YTDLP_BYTES  size of the written file (default 4 KB)
 */
import { appendFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
if (args.includes("--version")) {
  console.log("2026.09.01-fake");
  process.exit(0);
}
if (process.env.FAKE_YTDLP_LOG)
  appendFileSync(process.env.FAKE_YTDLP_LOG, JSON.stringify(args) + "\n");

const mode = process.env.FAKE_YTDLP_MODE ?? "";
if (mode === "fail") {
  console.error("ERROR: [Instagram] abc: Requested content is not available, login required");
  process.exit(1);
}
if (mode === "nothing") process.exit(0);

const template = args[args.indexOf("-o") + 1];
const dir = path.dirname(template);
const url = args[args.length - 1];
const size = Number(process.env.FAKE_YTDLP_BYTES ?? 4096);
const header = Buffer.from([0, 0, 0, 0x18, ...Buffer.from("ftypisom"), 0, 0, 2, 0]);
const body = Buffer.alloc(Math.max(size, header.length), 7);
header.copy(body);
// Distinct bytes per URL: two clips must not dedupe into one asset.
body.write(url, header.length);
writeFileSync(path.join(dir, "media.mp4"), body);
writeFileSync(
  path.join(dir, "media.info.json"),
  JSON.stringify({
    title: "Residency in 45 days?",
    uploader: "expat.desk",
    description: "Comment GUIA for the guide",
  }),
);
