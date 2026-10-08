"use server";

/**
 * Settings → Meta writes (PLAN.md §5.O12). Owner only. Saving the app
 * credentials rewrites the local `.env`, so that one also needs localhost,
 * like the rest of Settings (§1.27).
 */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { revalidatePath } from "next/cache";

import { requireOwner } from "@/lib/auth/session";
import { encryptionKeyProblem, generateEncryptionKey } from "@/lib/crypto";
import { isLocalRequest } from "@/lib/settings.actions";
import { writeEnv } from "@/lib/settings/envfile";

import { GraphClient } from "./graph";
import { disconnectMeta, listMetaIntegrations, usableToken } from "./integration";
import { autoLinkByHandle, linkAccount, unlinkAccount } from "./link";
import { listMetaTargets } from "./pages";
import { syncMeta } from "./sync";

export type MetaActionResult = { ok: true; message?: string } | { ok: false; error: string };

async function owner(): Promise<string | null> {
  try {
    await requireOwner("change the Meta connection");
    return null;
  } catch {
    return "Only the owner can change the Meta connection.";
  }
}

const done = (message?: string): MetaActionResult => {
  revalidatePath("/settings");
  return { ok: true, message };
};

export async function saveMetaAppAction(
  _prev: MetaActionResult | null,
  form: FormData,
): Promise<MetaActionResult> {
  const denied = await owner();
  if (denied) return { ok: false, error: denied };
  if (!(await isLocalRequest())) {
    return { ok: false, error: "The Meta app keys can only be saved on localhost." };
  }

  const get = (k: string) =>
    typeof form.get(k) === "string" ? (form.get(k) as string).trim() : "";
  const appId = get("META_APP_ID");
  const appSecret = get("META_APP_SECRET");
  const configId = get("META_LOGIN_CONFIG_ID");
  if (appId && !/^\d{5,25}$/.test(appId)) return { ok: false, error: "The App ID is only digits." };
  if (appSecret && !/^[0-9a-f]{32}$/i.test(appSecret)) {
    return { ok: false, error: "The App Secret is 32 letters and digits (0–9, a–f)." };
  }
  if (configId && !/^\d{5,25}$/.test(configId)) {
    return { ok: false, error: "The configuration ID is only digits." };
  }

  const updates: Record<string, string | null> = {};
  if (appId) updates.META_APP_ID = appId;
  if (appSecret) updates.META_APP_SECRET = appSecret;
  if (configId) updates.META_LOGIN_CONFIG_ID = configId;
  if (form.get("clear:META_LOGIN_CONFIG_ID") === "on") updates.META_LOGIN_CONFIG_ID = null;

  let generatedKey = false;
  if (!process.env.ENCRYPTION_KEY) {
    updates.ENCRYPTION_KEY = generateEncryptionKey();
    generatedKey = true;
  } else if (encryptionKeyProblem()) {
    return { ok: false, error: `${encryptionKeyProblem()} Fix it in .env first.` };
  }
  if (Object.keys(updates).length === 0) return { ok: true };

  const envPath = path.join(process.cwd(), ".env");
  try {
    const current = await readFile(envPath, "utf8").catch(() => "");
    await writeFile(envPath, writeEnv(current, updates), "utf8");
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  for (const [k, v] of Object.entries(updates)) {
    if (v === null) delete process.env[k];
    else process.env[k] = v;
  }
  return done(
    generatedKey
      ? "Saved. An ENCRYPTION_KEY was also created in .env — keep a copy of .env; without that key a saved Meta login cannot be read."
      : "Saved.",
  );
}

export async function linkAccountAction(
  _prev: MetaActionResult | null,
  form: FormData,
): Promise<MetaActionResult> {
  const denied = await owner();
  if (denied) return { ok: false, error: denied };
  const accountId = Number(form.get("accountId"));
  const integrationId = Number(form.get("integrationId"));
  const externalId = String(form.get("externalId") ?? "").trim();
  if (!Number.isInteger(accountId) || accountId <= 0)
    return { ok: false, error: "Pick an account." };
  try {
    if (!externalId) {
      await unlinkAccount(accountId);
      return done("Unlinked.");
    }
    if (!/^\d+$/.test(externalId)) return { ok: false, error: "That is not a Meta id." };
    if (!Number.isInteger(integrationId) || integrationId <= 0) {
      return { ok: false, error: "Connect Meta first." };
    }
    if (!(await listMetaIntegrations()).some((r) => r.id === integrationId)) {
      return { ok: false, error: "That Meta connection no longer exists. Reload the page." };
    }
    await linkAccount(accountId, { externalId, integrationId });
    return done("Linked.");
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function autoLinkAction(): Promise<MetaActionResult> {
  const denied = await owner();
  if (denied) return { ok: false, error: denied };
  let linked = 0;
  for (const row of await listMetaIntegrations()) {
    const token = await usableToken(row);
    if (!token.ok) continue;
    try {
      const targets = await listMetaTargets(new GraphClient(token.token));
      linked += await autoLinkByHandle(targets, row.id);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
  return done(`${linked} Instagram account(s) linked by matching handle.`);
}

export async function syncNowAction(): Promise<MetaActionResult> {
  const denied = await owner();
  if (denied) return { ok: false, error: denied };
  const r = await syncMeta();
  const summary = `${r.accounts} account(s), ${r.postsMatched} post(s) matched, ${r.snapshots} snapshot(s).`;
  revalidatePath("/settings");
  return r.errors.length
    ? { ok: false, error: `${summary} Problems: ${r.errors.slice(0, 3).join(" · ")}` }
    : { ok: true, message: summary };
}

export async function disconnectMetaAction(form: FormData): Promise<void> {
  if (await owner()) return;
  const id = Number(form.get("integrationId"));
  if (Number.isInteger(id) && id > 0) await disconnectMeta(id);
  revalidatePath("/settings");
}
