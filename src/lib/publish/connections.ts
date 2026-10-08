import { upsertReturning } from "@/db/mutations";
import "server-only";
import { and, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { integrations, socialAccounts, type Integration } from "@/db/schema";
import { decryptSecret, encryptSecret, encryptionKeyProblem } from "@/lib/crypto";

import { PROVIDER_NAME, ProviderApiError, type VideoProvider } from "./provider-error";

/**
 * The `integrations` rows for YouTube and TikTok (build 4 §3.F). Both hand
 * out a short-lived access token and a long-lived refresh token, so the row's
 * one ciphertext holds both as encrypted JSON (src/lib/crypto.ts, §1.50):
 *
 *   { v: 1, accessToken, accessExpiresAt, refreshToken }
 *
 * `token_expires_at` is when the *login* ends (TikTok's refresh token: a
 * year; Google's: null, it lasts until revoked). The access token is renewed
 * here, before a call, whenever it has less than a minute left.
 */

export type TokenBundle = {
  accessToken: string;
  accessExpiresAt: Date;
  refreshToken: string;
};

type Stored = { v: 1; accessToken: string; accessExpiresAt: string; refreshToken: string };

const SKEW_MS = 60_000;

function seal(t: TokenBundle): string {
  const stored: Stored = {
    v: 1,
    accessToken: t.accessToken,
    accessExpiresAt: t.accessExpiresAt.toISOString(),
    refreshToken: t.refreshToken,
  };
  return encryptSecret(JSON.stringify(stored));
}

function open(ciphertext: string): TokenBundle {
  const s = JSON.parse(decryptSecret(ciphertext)) as Partial<Stored>;
  if (s.v !== 1 || !s.refreshToken) throw new Error("The stored login has an unknown format.");
  return {
    accessToken: s.accessToken ?? "",
    accessExpiresAt: new Date(s.accessExpiresAt ?? 0),
    refreshToken: s.refreshToken,
  };
}

/** Insert or refresh the row for this channel / creator; tokens go in encrypted. */
export async function saveConnection(input: {
  provider: VideoProvider;
  accountRef: string;
  label: string;
  tokens: TokenBundle;
  scopes: string[];
  loginExpiresAt: Date | null;
}): Promise<Integration> {
  const values = {
    label: input.label.slice(0, 255),
    tokenCiphertext: seal(input.tokens),
    tokenExpiresAt: input.loginExpiresAt,
    scopes: input.scopes,
    status: "ok" as const,
    lastError: null,
    updatedAt: new Date(),
  };
  const [row] = await upsertReturning(
    db,
    integrations,
    { provider: input.provider, accountRef: input.accountRef, ...values },
    {
      target: [integrations.provider, integrations.accountRef],
      set: { ...values, credentialVersion: sql`${integrations.credentialVersion} + 1` },
    },
  );

  return row;
}

export async function listConnections(provider: VideoProvider): Promise<Integration[]> {
  return db.select().from(integrations).where(eq(integrations.provider, provider));
}

export async function getConnection(
  provider: VideoProvider,
  id: number,
): Promise<Integration | null> {
  const [row] = await db
    .select()
    .from(integrations)
    .where(and(eq(integrations.id, id), eq(integrations.provider, provider)))
    .limit(1);
  return row ?? null;
}

export async function setConnectionStatus(
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

/** A renewed bundle; `refreshExpiresAt`, when given, moves the login's end too. */
export type Refresher = (
  refreshToken: string,
  now: Date,
) => Promise<TokenBundle & { refreshExpiresAt?: Date | null }>;

/**
 * A usable access token for the row, refreshing (and re-sealing) it when it is
 * about to expire. A refused refresh marks the row `expired`: reconnect.
 */
export async function accessToken(
  initial: Integration,
  refresh: Refresher,
  now = new Date(),
): Promise<{ ok: true; token: string; credentialVersion: number } | { ok: false; reason: string }> {
  // Lock and re-read, rather than refreshing the caller's stale ciphertext.
  // A reconnect waits for this transaction and therefore always supersedes it.
  return db.transaction(async (tx) => {
    await tx.execute(sql`select id from integrations where id = ${initial.id} for update`);
    const [row] = await tx.select().from(integrations).where(eq(integrations.id, initial.id));
    if (!row || row.provider !== initial.provider)
      return { ok: false as const, reason: "The connection was removed. Connect again." };
    const name = PROVIDER_NAME[row.provider as VideoProvider] ?? row.provider;
    const reconnect = `The ${name} login expired. Reconnect in Settings → ${name}.`;
    const fail = async (status: Integration["status"], reason: string) => {
      await tx
        .update(integrations)
        .set({ status, lastError: reason.slice(0, 1024), updatedAt: new Date() })
        .where(eq(integrations.id, row.id));
      return { ok: false as const, reason };
    };
    if (row.status === "disabled")
      return { ok: false as const, reason: "The connection is switched off." };
    if (row.status === "expired") return { ok: false as const, reason: row.lastError ?? reconnect };
    const keyProblem = encryptionKeyProblem();
    if (keyProblem) return { ok: false as const, reason: keyProblem };
    if (!row.tokenCiphertext)
      return { ok: false as const, reason: "No token stored. Connect again." };
    if (row.tokenExpiresAt && row.tokenExpiresAt.getTime() <= now.getTime())
      return fail("expired", reconnect);
    let bundle: TokenBundle;
    try {
      bundle = open(row.tokenCiphertext);
    } catch (err) {
      return fail("error", err instanceof Error ? err.message : String(err));
    }
    if (bundle.accessToken && bundle.accessExpiresAt.getTime() - SKEW_MS > now.getTime())
      return {
        ok: true as const,
        token: bundle.accessToken,
        credentialVersion: row.credentialVersion,
      };
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const fresh = await Promise.race([
        refresh(bundle.refreshToken, now),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new ProviderApiError(
                  "Token refresh timed out.",
                  row.provider as VideoProvider,
                  0,
                  null,
                  false,
                  true,
                ),
              ),
            30_000,
          );
        }),
      ]);
      await tx
        .update(integrations)
        .set({
          tokenCiphertext: seal(fresh),
          credentialVersion: row.credentialVersion + 1,
          ...(fresh.refreshExpiresAt !== undefined
            ? { tokenExpiresAt: fresh.refreshExpiresAt }
            : {}),
          status: "ok",
          lastError: null,
          updatedAt: new Date(),
        })
        .where(eq(integrations.id, row.id));
      return {
        ok: true as const,
        token: fresh.accessToken,
        credentialVersion: row.credentialVersion + 1,
      };
    } catch (err) {
      if (err instanceof ProviderApiError && err.isAuthError)
        return fail(
          "expired",
          `${name} refused to renew the login (${err.message}). Reconnect in Settings → ${name}.`,
        );
      if (err instanceof ProviderApiError && err.isTransient) throw err;
      return {
        ok: false as const,
        reason: `Could not renew the ${name} login: ${err instanceof Error ? err.message : String(err)}`,
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  });
}

/** Remove the connection; linked accounts keep their platform id but lose the link. */
export async function disconnect(provider: VideoProvider, id: number): Promise<void> {
  await db
    .update(socialAccounts)
    .set({ integrationId: null })
    .where(eq(socialAccounts.integrationId, id));
  await db
    .delete(integrations)
    .where(and(eq(integrations.id, id), eq(integrations.provider, provider)));
}

/** The row without its ciphertext, for pages. */
export function withoutToken(row: Integration): Omit<Integration, "tokenCiphertext"> {
  const { tokenCiphertext, ...rest } = row;
  void tokenCiphertext;
  return rest;
}

/** Link a content-engine account to a channel / creator; one account per platform id. */
export async function linkVideoAccount(
  accountId: number,
  platform: VideoProvider,
  link: { externalId: string; integrationId: number },
): Promise<void> {
  const [account] = await db
    .select({ platform: socialAccounts.platform })
    .from(socialAccounts)
    .where(eq(socialAccounts.id, accountId))
    .limit(1);
  if (!account) throw new Error(`No account ${accountId}.`);
  if (account.platform !== platform) {
    throw new Error(`Only ${PROVIDER_NAME[platform]} accounts link to ${PROVIDER_NAME[platform]}.`);
  }
  await db
    .update(socialAccounts)
    .set({ externalId: null, integrationId: null })
    .where(
      and(eq(socialAccounts.platform, platform), eq(socialAccounts.externalId, link.externalId)),
    );
  await db
    .update(socialAccounts)
    .set({ externalId: link.externalId, integrationId: link.integrationId })
    .where(eq(socialAccounts.id, accountId));
}

export async function unlinkVideoAccount(accountId: number): Promise<void> {
  await db
    .update(socialAccounts)
    .set({ externalId: null, integrationId: null })
    .where(eq(socialAccounts.id, accountId));
}
