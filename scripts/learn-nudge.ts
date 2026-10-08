/**
 * The weekly "implement one thing" nudge (docs/LEARN.md), for Windows Task
 * Scheduler: picks one unimplemented learn item and sends it to the first
 * chat id in TELEGRAM_ALLOWED_CHAT_IDS through the capture bot
 * (TELEGRAM_BOT_TOKEN). No model call. Use this or the Worker's cron, not both.
 *
 *   npm run learn:nudge [--dry-run]
 */

import { closeDb } from "../src/db";
import { runWeeklyNudge } from "../src/lib/learn/send";

async function main(): Promise<number> {
  const result = await runWeeklyNudge({ dryRun: process.argv.includes("--dry-run") });
  switch (result.status) {
    case "nothing":
      console.log("No unimplemented learn items: nothing to nudge about.");
      return 0;
    case "failed":
      console.error(`Nudge not sent: ${result.error}`);
      return 1;
    case "dry-run":
      console.log(`Would send (clip ${result.item.id}):\n\n${result.text}`);
      return 0;
    case "sent":
      console.log(`Nudge sent for clip ${result.item.id}.`);
      return 0;
  }
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
