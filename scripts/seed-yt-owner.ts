import { upsertReturning } from "@/db/mutations";
/**
 * PR-03 seed for the YouTube tool's `users` table (owner/employee login).
 *
 *   export DATABASE_URL='mysql://user:pass@host/dbname'
 *   export ADMIN_EMAIL='you@example.com'
 *   export ADMIN_PASSWORD='...'          # optional; sets/updates the login password
 *   npx tsx scripts/seed-yt-owner.ts
 *
 * tsx does not auto-load .env, so export the vars explicitly (or run via
 * `node --env-file=.env` / `dotenv -e .env --`).
 *
 * Named separately from `npm run db:seed` (src/db/seed.ts), which seeds the
 * brands table for the content-ideation side — the two seed different halves
 * of the merged app and neither should silently also run the other.
 */

import "dotenv/config";
import { db } from "../src/db";
import { users } from "../src/db/schema";

async function main(): Promise<void> {
  const email = process.env.ADMIN_EMAIL;
  if (!email) {
    throw new Error(
      "ADMIN_EMAIL is not set. This user is seeded with role 'owner' — the " +
        "only role that can spend money (PR-24).",
    );
  }

  // ADMIN_PASSWORD is optional so an existing seeded database is not forced to
  // change its password on every re-run. Omitting it leaves the stored hash
  // exactly as it was; a user with no hash simply cannot log in (PR-23).
  const password = process.env.ADMIN_PASSWORD;
  if (password !== undefined && password.length < 12) {
    throw new Error(
      "ADMIN_PASSWORD must be at least 12 characters. It is the only credential " +
        "protecting a tool that can spend money.",
    );
  }
  const { hashPassword } = await import("../src/lib/auth/password");
  const passwordHash = password ? await hashPassword(password) : undefined;

  // Upsert on the unique email rather than insert-then-catch, so re-running
  // after changing the role actually applies the change.
  await upsertReturning(
    db,
    users,
    { email, role: "owner", passwordHash },
    {
      target: users.email,
      set: passwordHash ? { role: "owner", passwordHash } : { role: "owner" },
    },
  );

  const rows = await db.select().from(users).orderBy(users.id);

  console.log(
    passwordHash
      ? "Seeded, password set."
      : "Seeded. No ADMIN_PASSWORD given, so no password was changed.",
  );
  console.log(`${rows.length} user row(s):`);
  for (const u of rows) {
    console.log(`  #${u.id}  ${u.email}  ${u.role}`);
  }

  console.log(
    "\nNo topics are seeded on purpose — PLAN.md §7 requires topics to be " +
      "open-ended, so none is hardcoded anywhere. They are created at analysis time.",
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Seed FAILED:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
