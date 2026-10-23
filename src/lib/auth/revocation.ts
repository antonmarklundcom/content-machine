import "server-only";
import { createHash } from "node:crypto";
import { and, eq, like, lte } from "drizzle-orm";
import { db } from "@/db";
import { applicationSettings } from "@/db/schema";

const PREFIX = "auth:revoked:";
export function revokedSessionKey(token: string): string {
  return PREFIX + createHash("sha256").update(token).digest("hex").slice(0, 51);
}
export async function sessionRevoked(token: string): Promise<boolean> {
  const [row] = await db
    .select({ key: applicationSettings.key })
    .from(applicationSettings)
    .where(eq(applicationSettings.key, revokedSessionKey(token)))
    .limit(1);
  return Boolean(row);
}
export async function revokeSession(token: string, expiresAt: number): Promise<void> {
  const key = revokedSessionKey(token);
  // The ledger contains a one-way token identity, never the cookie or user data.
  await db
    .insert(applicationSettings)
    .values({ key, value: { revoked: true }, updatedAt: new Date(expiresAt) })
    .onDuplicateKeyUpdate({ set: { key } });
  await db
    .delete(applicationSettings)
    .where(
      and(
        like(applicationSettings.key, `${PREFIX}%`),
        lte(applicationSettings.updatedAt, new Date()),
      ),
    );
}
