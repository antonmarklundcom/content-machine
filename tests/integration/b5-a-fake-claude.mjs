/**
 * A stand-in for Claude Code running `/higgsfield-voice` (build 5 phase A):
 * no login, no Higgsfield, no network. Reads the prompt from stdin, finds the
 * line manifest, writes a short WAV tone at each line's `outFile` under
 * MEDIA_ROOT and prints the voice HF_* lines as stream-json.
 *
 *   FAKE_VOICE_FAIL   comma list of 0-based line indexes that print HF_FAIL instead of a file
 *   FAKE_VOICE_CREDITS  total credits to report (default 3)
 *   FAKE_VOICE_LOG    append {args, stdin} (JSON, one line) here
 */
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const emit = (o) => process.stdout.write(JSON.stringify(o) + "\n");
const say = (text) => emit({ type: "assistant", message: { content: [{ type: "text", text }] } });

if (args.includes("--version")) {
  console.log("2.0.99 (Claude Code)");
  process.exit(0);
}

function tone(ms, freq) {
  const rate = 48000;
  const samples = Math.round((rate * ms) / 1000);
  const buf = Buffer.alloc(44 + samples * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + samples * 2, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++)
    buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * freq * i) / rate) * 3000), 44 + i * 2);
  return buf;
}

let stdin = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => (stdin += d));
process.stdin.on("end", () => {
  if (process.env.FAKE_VOICE_LOG)
    appendFileSync(process.env.FAKE_VOICE_LOG, JSON.stringify({ args, stdin }) + "\n");
  emit({
    type: "system",
    subtype: "init",
    mcp_servers: [{ name: "higgsfield", status: "connected" }],
  });
  const start = stdin.indexOf("```json\n");
  const end = stdin.indexOf("\n```", start + 8);
  const manifest = JSON.parse(stdin.slice(start + 8, end));
  const fail = new Set((process.env.FAKE_VOICE_FAIL ?? "").split(",").filter(Boolean).map(Number));
  say("HF_BALANCE before 100");
  const root = process.env.MEDIA_ROOT;
  manifest.lines.forEach((line, i) => {
    say(`HF_JOB ${line.lineId} hf-${line.lineId}`);
    if (fail.has(i)) {
      say(`HF_FAIL ${line.lineId} voice id not found`);
      return;
    }
    // Real WAV bytes whatever the extension: ffmpeg reads by content.
    const abs = path.join(root, ...line.outFile.split("/"));
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, tone(Math.max(500, line.text.length * 40), 300 + i * 40));
    say(`HF_FILE ${line.outFile}`);
  });
  const credits = process.env.FAKE_VOICE_CREDITS ?? "3";
  emit({
    type: "result",
    subtype: "success",
    is_error: false,
    result: `Done.\nHF_BALANCE after ${100 - Number(credits)}\nHF_CREDITS ${credits}`,
    permission_denials: [],
  });
  process.exit(0);
});
