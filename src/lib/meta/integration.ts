import { upsertReturning } from "@/db/mutations";
import "server-only";
import { and, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { integrations, socialAccounts, type Integration } from "@/db/schema";
import { decryptSecret, encryptSecret, encryptionKeyProblem } from "@/lib/crypto";

import type { MetaConnection } from "./oauth";

/**
 * The `integrations` rows for Meta (PLAN.md §1.50, §5.O12). One row per
 * connected Meta user; `account_ref` is the Meta user id. The token only ever
 * enters and leaves the row through src/lib/crypto.ts.
 */

/** A token closer than this to expiry gets a "reconnect soon" banner. */
export const EXPIRY_WARNING_DAYS = 7;

/** Insert or refresh the row for this Meta user; the token goes in encrypted. */
export async function saveMetaConnection(conn: MetaConnection): Promise<Integration> {
  const values = {
    label: `Meta — ${conn.userName}`.slice(0, 255),
    tokenCiphertext: encryptSecret(conn.token),
    tokenExpiresAt: conn.expiresAt,
    scopes: conn.scopes,
    status: "ok" as const,
    lastError: null,
    updatedAt: new Date(),
  };
  const [row] = await upsertReturning(
    db,
    integrations,
    { provider: "meta", accountRef: conn.userId, ...values },
    {
      target: [integrations.provider, integrations.accountRef],
      set: { ...values, credentialVersion: sql`${integrations.credentialVersion} + 1` },
    },
  );

  return row;
}

export async function listMetaIntegrations(): Promise<Integration[]> {
  return db.select().from(integrations).where(eq(integrations.provider, "meta"));
}

export async function setIntegrationStatus(
  id: number,
  status: Integration["status"],
  lastError: string | null,
  expectedVersion?: number,
): Promise<void> {
  await db
    .update(integrations)
    .set({ status, lastError: lastError?.slice(0, 1024) ?? null, updatedAt: new Date() })
    .where(
      and(
        eq(integrations.id, id),
        expectedVersion === undefined
          ? undefined
          : eq(integrations.credentialVersion, expectedVersion),
      ),
    );
}

/**
 * The integration's token, or why there is none. A token past its expiry date
 * flips the row to `expired` here, before any call is made with it.
 */
export async function usableToken(
  row: Integration,
  now = new Date(),
): Promise<{ ok: true; token: string } | { ok: false; reason: string }> {
  if (row.status === "disabled") return { ok: false, reason: "The connection is switched off." };
  if (row.status === "expired") return { ok: false, reason: "The Meta login expired. Reconnect." };
  const keyProblem = encryptionKeyProblem();
  if (keyProblem) return { ok: false, reason: keyProblem };
  if (!row.tokenCiphertext) return { ok: false, reason: "No token stored. Connect again." };
  if (row.tokenExpiresAt && row.tokenExpiresAt.getTime() <= now.getTime()) {
    await setIntegrationStatus(
      row.id,
      "expired",
      "The Meta login expired. Reconnect.",
      row.credentialVersion,
    );
    return { ok: false, reason: "The Meta login expired. Reconnect." };
  }
  try {
    return { ok: true, token: decryptSecret(row.tokenCiphertext) };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await setIntegrationStatus(row.id, "error", reason, row.credentialVersion);
    return { ok: false, reason };
  }
}

/** Remove the connection: the row goes, accounts keep their Meta ids but lose the link. */
export async function disconnectMeta(id: number): Promise<void> {
  await db
    .update(socialAccounts)
    .set({ integrationId: null })
    .where(eq(socialAccounts.integrationId, id));
  await db
    .delete(integrations)
    .where(and(eq(integrations.id, id), eq(integrations.provider, "meta")));
}

export type ExpiryBanner = { level: "expired" | "error" | "soon"; message: string } | null;

/** The Settings banner for one row (§5.O12 exit: expiry shows a banner). */
export function expiryBanner(row: Integration, now = new Date()): ExpiryBanner {
  const expiredByDate = row.tokenExpiresAt && row.tokenExpiresAt.getTime() <= now.getTime();
  if (row.status === "expired" || expiredByDate) {
    return { level: "expired", message: row.lastError ?? "The Meta login expired. Reconnect." };
  }
  if (row.status === "error") return { level: "error", message: row.lastError ?? "Error." };
  if (row.tokenExpiresAt) {
    const days = (row.tokenExpiresAt.getTime() - now.getTime()) / 86_400_000;
    if (days < EXPIRY_WARNING_DAYS) {
      return {
        level: "soon",
        message: `The Meta login expires in ${Math.max(0, Math.ceil(days))} day(s). Reconnect to renew it.`,
      };
    }
  }
  return null;
}
