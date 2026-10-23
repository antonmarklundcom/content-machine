import "server-only";
import { and, eq, like, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { applicationSettings } from "@/db/schema";
import { queryRows } from "@/db/mutations";

import {
  LOGIN_WINDOW_MS,
  LOGIN_ACCOUNT_LIMIT,
  LOGIN_GLOBAL_LIMIT,
  LOGIN_ATTEMPT_PREFIX,
  loginAttemptKey,
  nextLoginAttempt,
} from "./throttle-policy";
export { LOGIN_ACCOUNT_LIMIT } from "./throttle-policy";

/** Database-backed and serialized across instances; hashes contain no email/IP values. */
export async function consumeLoginAttempt(email: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    // Global row is always first: bounds account-key growth and bcrypt work,
    // without trusting a caller-controlled forwarded IP address.
    const keys = ["auth:global", loginAttemptKey(email)];
    let now = 0;
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      await tx
        .insert(applicationSettings)
        .values({ key, value: {}, updatedAt: sql`current_timestamp(3)` })
        .onDuplicateKeyUpdate({ set: { key } });
      const [row] = await tx
        .select()
        .from(applicationSettings)
        .where(eq(applicationSettings.key, key))
        .for("update");
      // Sample only AFTER the serialized global lock. A request that waited
      // must not compare a newer window to its older, pre-lock timestamp.
      if (i === 0) {
        const [{ nowMs }] = await queryRows<{ nowMs: string }>(
          tx,
          sql`select cast(unix_timestamp(current_timestamp(3)) * 1000 as unsigned) as nowMs`,
        );
        now = Number(nowMs);
      }
      const next = nextLoginAttempt(row.value, now);
      if (next.count > (i === 0 ? LOGIN_GLOBAL_LIMIT : LOGIN_ACCOUNT_LIMIT)) return false;
      await tx
        .update(applicationSettings)
        .set({ value: next, updatedAt: new Date(now) })
        .where(eq(applicationSettings.key, key));
    }
    await tx
      .delete(applicationSettings)
      .where(
        and(
          like(applicationSettings.key, `${LOGIN_ATTEMPT_PREFIX}%`),
          lt(applicationSettings.updatedAt, new Date(now - LOGIN_WINDOW_MS)),
        ),
      );
    return true;
  });
}

export async function clearLoginAttempts(email: string): Promise<void> {
  await db.delete(applicationSettings).where(eq(applicationSettings.key, loginAttemptKey(email)));
}
