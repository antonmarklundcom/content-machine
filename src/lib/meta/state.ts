import "server-only";
import { asc } from "drizzle-orm";

import { db } from "@/db";
import { socialAccounts, type Integration, type SocialAccount } from "@/db/schema";
import { encryptionKeyProblem } from "@/lib/crypto";

import { metaConfig } from "./config";
import { GraphClient, graphFetch, MetaGraphError, type GraphFetch } from "./graph";
import {
  expiryBanner,
  listMetaIntegrations,
  setIntegrationStatus,
  usableToken,
  type ExpiryBanner,
} from "./integration";
import { listMetaTargets, type MetaTarget } from "./pages";
import { setupSteps, type SetupStep } from "./setup";

/**
 * Everything the Settings page's Meta section shows (PLAN.md §5.O12): the
 * setup checklist, the connection and its banner, and what Meta lists for
 * mapping. One Graph call (`me/accounts`) per render while connected.
 */

export type MetaState = {
  steps: SetupStep[];
  appId: string | null;
  loginConfigId: string | null;
  appSecretSet: boolean;
  keyProblem: string | null;
  integration: Omit<Integration, "tokenCiphertext"> | null;
  banner: ExpiryBanner;
  targets: MetaTarget[] | null;
  targetsError: string | null;
  accounts: SocialAccount[];
};

function withoutToken(row: Integration): Omit<Integration, "tokenCiphertext"> {
  const { tokenCiphertext, ...rest } = row;
  void tokenCiphertext;
  return rest;
}

export async function metaState(
  fetchImpl: GraphFetch = graphFetch(),
  now = new Date(),
): Promise<MetaState> {
  const [rows, accounts] = await Promise.all([
    listMetaIntegrations(),
    db
      .select()
      .from(socialAccounts)
      .orderBy(asc(socialAccounts.platform), asc(socialAccounts.handle)),
  ]);
  // The newest connection is the one shown; more than one only happens when two people connect.
  const row = rows.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0] ?? null;

  let targets: MetaTarget[] | null = null;
  let targetsError: string | null = null;
  let status = row?.status ?? null;
  if (row) {
    const token = await usableToken(row, now);
    if (token.ok) {
      try {
        targets = await listMetaTargets(new GraphClient(token.token, fetchImpl));
      } catch (err) {
        targetsError = err instanceof Error ? err.message : String(err);
        if (err instanceof MetaGraphError && err.isTokenError) {
          await setIntegrationStatus(
            row.id,
            "expired",
            `Meta rejected the login: ${err.message}`,
            row.credentialVersion,
          );
          status = "expired";
        }
      }
    } else {
      targetsError = token.reason;
      if (/expired/i.test(token.reason)) status = "expired";
    }
  }

  const env = process.env;
  const keyProblem = encryptionKeyProblem();
  const shown = row ? { ...row, status: status ?? row.status } : null;
  return {
    steps: setupSteps({
      accounts,
      appIdSet: Boolean(env.META_APP_ID?.trim()),
      appSecretSet: Boolean(env.META_APP_SECRET?.trim()),
      encryptionKeyOk: keyProblem === null,
      connected: !shown
        ? "none"
        : shown.status === "ok"
          ? "ok"
          : shown.status === "expired"
            ? "expired"
            : "error",
      metaIgUsernames: targets
        ? targets.flatMap((t) => (t.igUsername ? [t.igUsername] : []))
        : null,
    }),
    appId: env.META_APP_ID?.trim() || null,
    loginConfigId: metaConfig()?.loginConfigId ?? (env.META_LOGIN_CONFIG_ID?.trim() || null),
    appSecretSet: Boolean(env.META_APP_SECRET?.trim()),
    keyProblem,
    integration: shown ? withoutToken(shown) : null,
    banner: shown ? expiryBanner(shown, now) : null,
    targets,
    targetsError,
    accounts,
  };
}
