"use server";

/**
 * Settings → YouTube / TikTok writes and the post editor's publish options
 * (build 4 §3.F). Owner only. Saving the OAuth client rewrites the local
 * `.env`, so that one also needs localhost, like the rest of Settings (§1.27).
 */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db } from "@/db";
import { posts } from "@/db/schema";
import { updatePost, PostEngineError } from "@/lib/posts/engine";
import { requireOwner } from "@/lib/auth/session";
import { encryptionKeyProblem, generateEncryptionKey } from "@/lib/crypto";
import { isLocalRequest } from "@/lib/settings.actions";
import { writeEnv } from "@/lib/settings/envfile";

import { disconnect, getConnection, linkVideoAccount, unlinkVideoAccount } from "./connections";
import {
  parseTikTokOptions,
  parseYouTubeOptions,
  withPlatformOptions,
  type TikTokOptions,
  type YouTubeOptions,
} from "./options";
import { PROVIDER_NAME, type VideoProvider } from "./provider-error";

export type VideoActionResult = { ok: true; message?: string } | { ok: false; error: string };

const isProvider = (v: unknown): v is VideoProvider => v === "youtube" || v === "tiktok";

async function owner(what: string): Promise<string | null> {
  try {
    await requireOwner(what);
    return null;
  } catch {
    return `Only the owner can ${what}.`;
  }
}

const done = (message?: string): VideoActionResult => {
  revalidatePath("/settings");
  return { ok: true, message };
};

const KEYS = {
  youtube: {
    id: "GOOGLE_OAUTH_CLIENT_ID",
    secret: "GOOGLE_OAUTH_CLIENT_SECRET",
    idPattern: /^[\w-]+\.apps\.googleusercontent\.com$/,
    idHint: "The client ID ends in .apps.googleusercontent.com.",
  },
  tiktok: {
    id: "TIKTOK_CLIENT_KEY",
    secret: "TIKTOK_CLIENT_SECRET",
    idPattern: /^[A-Za-z0-9]{8,64}$/,
    idHint: "The client key is letters and digits.",
  },
} as const;

export async function saveVideoAppAction(
  _prev: VideoActionResult | null,
  form: FormData,
): Promise<VideoActionResult> {
  const provider = form.get("provider");
  if (!isProvider(provider)) return { ok: false, error: "Unknown platform." };
  const denied = await owner(`change the ${PROVIDER_NAME[provider]} connection`);
  if (denied) return { ok: false, error: denied };
  if (!(await isLocalRequest())) {
    return { ok: false, error: "The app keys can only be saved on localhost." };
  }
  const keys = KEYS[provider];
  const get = (k: string) =>
    typeof form.get(k) === "string" ? (form.get(k) as string).trim() : "";
  const id = get(keys.id);
  const secret = get(keys.secret);
  if (id && !keys.idPattern.test(id)) return { ok: false, error: keys.idHint };
  if (secret && !/^[\w.-]{8,128}$/.test(secret)) {
    return { ok: false, error: "That secret does not look right; copy it again." };
  }

  const updates: Record<string, string | null> = {};
  if (id) updates[keys.id] = id;
  if (secret) updates[keys.secret] = secret;
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
      ? "Saved. An ENCRYPTION_KEY was also created in .env — keep a copy of .env; without it a saved login cannot be read."
      : "Saved.",
  );
}

/** Link (or, with no connection picked, unlink) a content-engine account. */
export async function linkVideoAccountAction(
  _prev: VideoActionResult | null,
  form: FormData,
): Promise<VideoActionResult> {
  const provider = form.get("provider");
  if (!isProvider(provider)) return { ok: false, error: "Unknown platform." };
  const denied = await owner(`change the ${PROVIDER_NAME[provider]} connection`);
  if (denied) return { ok: false, error: denied };
  const accountId = Number(form.get("accountId"));
  const integrationId = Number(form.get("integrationId") || 0);
  if (!Number.isInteger(accountId) || accountId <= 0)
    return { ok: false, error: "Pick an account." };
  try {
    if (!integrationId) {
      await unlinkVideoAccount(accountId);
      return done("Unlinked.");
    }
    const row = await getConnection(provider, integrationId);
    if (!row?.accountRef) {
      return { ok: false, error: "That connection no longer exists. Reload the page." };
    }
    await linkVideoAccount(accountId, provider, {
      externalId: row.accountRef,
      integrationId: row.id,
    });
    return done("Linked.");
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function disconnectVideoAction(form: FormData): Promise<void> {
  const provider = form.get("provider");
  if (!isProvider(provider)) return;
  if (await owner(`change the ${PROVIDER_NAME[provider]} connection`)) return;
  const id = Number(form.get("integrationId"));
  if (Number.isInteger(id) && id > 0) await disconnect(provider, id);
  revalidatePath("/settings");
}

/** The post editor's YouTube / TikTok options box: validates, then replaces that platform's section. */
export async function savePublishOptionsAction(
  postId: number,
  platform: VideoProvider,
  value: YouTubeOptions | TikTokOptions,
): Promise<VideoActionResult> {
  if (!Number.isInteger(postId) || postId <= 0)
    return { ok: false, error: "That is not a post id." };
  if (!isProvider(platform)) return { ok: false, error: "Unknown platform." };
  const denied = await owner("change a post's publish options");
  if (denied) return { ok: false, error: denied };
  const parsed =
    platform === "youtube"
      ? parseYouTubeOptions({ youtube: value })
      : parseTikTokOptions({ tiktok: value });
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const [post] = await db.select().from(posts).where(eq(posts.id, postId)).limit(1);
  if (!post) return { ok: false, error: `No post ${postId}.` };
  if (post.status === "publishing" || post.status === "published") {
    return { ok: false, error: "The post is already being published or is published." };
  }
  try {
    await updatePost(
      postId,
      {
        publishOptions: withPlatformOptions(post.publishOptions, platform, parsed.value),
      },
      { expectedRevision: post.revision },
    );
  } catch (error) {
    if (error instanceof PostEngineError) return { ok: false, error: error.message };
    throw error;
  }
  revalidatePath(`/posts/${postId}`);
  return { ok: true, message: "Saved." };
}
