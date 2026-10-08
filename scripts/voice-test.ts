/**
 * The voice gate from a terminal (docs/VOICE.md): render one text with
 * several voice profiles into the voice-test folder
 * (`MEDIA_ROOT/voice/voice-test/<run>/_all/<language>/take-<id>.{wav,mp3}`).
 * The takes show up on /voice/test, where the winner is marked.
 *
 *   npm run voice:test -- --profiles tania,mario,ana --language es-PY --text "Che, ¿vos sabés…?"
 *   npm run voice:test -- --profiles tania,mario --file content/voice-gate-es-py.txt
 *   (until the script is added to package.json:
 *    npx tsx --conditions=react-server scripts/voice-test.ts --profiles … )
 *
 * `--fake` uses the voice test double (no keys, no spend). Each profile is
 * rendered on its own: one refusal (consent, missing key) does not stop the
 * others. Exits 1 when any take failed.
 */

import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";

import { closeDb } from "../src/db";
import {
  narrate,
  NarrationRefusedError,
  VOICE_LANGUAGES,
  type VoiceLanguage,
} from "../src/lib/voice";
import { getProfileByKey } from "../src/lib/voice/store";

const USAGE =
  'Usage: voice-test --profiles key1,key2[,…] [--language es-PY] (--text "…" | --file path) [--fake]';

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      profiles: { type: "string" },
      language: { type: "string", default: "es-PY" },
      text: { type: "string" },
      file: { type: "string" },
      fake: { type: "boolean", default: false },
    },
  });
  if (values.fake) process.env.VOICE_FAKE = "1";
  const keys = (values.profiles ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
  const language = values.language as VoiceLanguage;
  const text = values.file ? await readFile(values.file, "utf8") : (values.text ?? "");
  if (!keys.length || !text.trim()) {
    console.error(USAGE);
    return 2;
  }
  if (!VOICE_LANGUAGES.includes(language)) {
    console.error(`Unknown language "${language}". One of: ${VOICE_LANGUAGES.join(", ")}`);
    return 2;
  }

  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
  const ownerRef = `voice-test:cli-${stamp}`;
  console.log(`Voice test ${ownerRef}: ${[...text].length} characters, ${language}`);
  let failed = 0;
  let total = 0;
  for (const key of keys) {
    const profile = await getProfileByKey(key);
    if (!profile) {
      console.error(`  ${key}: no such voice profile`);
      failed++;
      continue;
    }
    try {
      const r = await narrate({
        ownerKind: "voice_test",
        ownerRef,
        language,
        voiceProfileId: profile.id,
        text,
      });
      total += r.costUsd;
      console.log(
        `  ${key} (${profile.provider}): ${(r.durationMs / 1000).toFixed(1)} s, $${r.costUsd.toFixed(4)} → ${r.playbackPath}`,
      );
    } catch (error) {
      failed++;
      const why = error instanceof NarrationRefusedError ? `refused (${error.reason})` : "failed";
      console.error(`  ${key}: ${why}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  console.log(`Total $${total.toFixed(4)}. Listen and pick the winner on /voice/test.`);
  return failed ? 1 : 0;
}

main()
  .then(async (code) => {
    await closeDb();
    process.exit(code);
  })
  .catch(async (err) => {
    console.error(err);
    await closeDb().catch(() => {});
    process.exit(1);
  });
