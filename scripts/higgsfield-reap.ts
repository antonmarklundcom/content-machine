/**
 * Fail Higgsfield runs whose process is gone (build 4 §3.H): `running` rows
 * with a dead pid (the app was restarted mid-run), runs far past
 * `HIGGSFIELD_JOB_TIMEOUT_MIN` (killed first), and rows stuck `queued`.
 * The /higgsfield page and every start do this too; this is for Task
 * Scheduler or a manual clean-up.
 *
 *   tsx --conditions=react-server scripts/higgsfield-reap.ts
 */

import { closeDb } from "../src/db";
import { reapJobs } from "../src/lib/higgsfield/run";

reapJobs()
  .then(async (ids) => {
    console.log(
      ids.length ? `Reaped job(s): ${ids.map((id) => `#${id}`).join(", ")}` : "Nothing to reap.",
    );
    await closeDb();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error(err);
    await closeDb().catch(() => {});
    process.exit(1);
  });
