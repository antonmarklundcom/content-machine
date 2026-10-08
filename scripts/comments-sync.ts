/**
 * Pull Instagram comments on recently published posts into `comment_drafts`
 * (build 4 §3.G), and optionally draft replies for the new ones. Replies are
 * never sent — they wait on /comments for a person (PLAN-build4 §1.11).
 *
 *   npm run comments:sync [-- --days 14] [-- --draft] [-- --limit 50]
 *
 * --draft spends (one model call per new comment, under the monthly cap).
 * Exits 0 when nothing failed, 1 when an account failed or a login expired.
 * Never prints a token.
 */

import { closeDb } from "../src/db";
import { draftComments } from "../src/lib/comments/draft";
import { newCommentIds, syncComments } from "../src/lib/comments/sync";
import { formatUsd } from "../src/lib/spend";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<number> {
  const days = Number(arg("--days") ?? 14);
  const r = await syncComments({ days: Number.isFinite(days) && days > 0 ? days : 14 });
  console.log(
    `Comments: ${r.accounts} account(s), ${r.posts} post(s) read, ${r.seen} comment(s) seen, ${r.inserted} new.`,
  );
  for (const e of r.errors) console.log(`  problem: ${e}`);

  if (process.argv.includes("--draft")) {
    const limit = Number(arg("--limit") ?? 50);
    const ids = await newCommentIds(undefined, Number.isInteger(limit) && limit > 0 ? limit : 50);
    const d = await draftComments(ids);
    console.log(
      `Drafted ${d.drafted} repl${d.drafted === 1 ? "y" : "ies"} (${d.needsHuman} need a person), cost ${formatUsd(d.costUsd)}.`,
    );
    for (const e of d.errors) console.log(`  problem: ${e}`);
  }
  return r.errors.length || r.expired.length ? 1 : 0;
}

main()
  .then(async (code) => {
    await closeDb();
    process.exit(code);
  })
  .catch(async (err) => {
    console.error(err instanceof Error ? err.message : err);
    await closeDb();
    process.exit(1);
  });
