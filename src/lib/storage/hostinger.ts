import { readFile } from "node:fs/promises";
import path from "node:path";

import { failure, type StorageDriver, type StorageFailure } from "./driver";

/**
 * The public tier (PLAN.md §1.41): the token-protected PHP endpoint in
 * `hosting/media-upload/` on the EU Hostinger account's `media.` subdomain.
 * It holds only what must be public — the files of posts being published, and
 * thumbnails — and `prunePublic()` removes them after the retention window.
 *
 *   MEDIA_UPLOAD_URL   https://media.example.com/upload.php  (delete.php sits beside it)
 *   MEDIA_UPLOAD_TOKEN the bearer token in the endpoint's config.php
 *   MEDIA_PUBLIC_BASE  https://media.example.com             (what public URLs start with)
 *
 * Keys are what the endpoint returns as `path` (`files/2026/09/<random>.jpg`):
 * the server picks the name, never the client.
 */

export type HostingerConfig = { uploadUrl: string; token: string; publicBase: string };

/** The endpoint's settings, or null when any is unset — a normal state until §7 item 6 is done. */
export function hostingerConfig(
  env: Record<string, string | undefined> = process.env,
): HostingerConfig | null {
  const uploadUrl = env.MEDIA_UPLOAD_URL?.trim();
  const token = env.MEDIA_UPLOAD_TOKEN?.trim();
  const publicBase = env.MEDIA_PUBLIC_BASE?.trim().replace(/\/+$/, "");
  if (!uploadUrl || !token || !publicBase) return null;
  return { uploadUrl, token, publicBase };
}

export const HOSTINGER_NOT_CONFIGURED =
  "Public media endpoint not configured — set MEDIA_UPLOAD_URL, MEDIA_UPLOAD_TOKEN and MEDIA_PUBLIC_BASE.";

/** Keys the endpoint hands out; anything else is never sent back to it. */
const KEY = /^files\/\d{4}\/\d{2}\/[a-f0-9]{32}\.(jpg|png|webp|gif|mp4|mov)$/;

export function isHostingerKey(key: string): boolean {
  return KEY.test(key);
}

/** The key of one of this endpoint's public URLs, or null for any other URL. */
export function hostingerKeyFromUrl(url: string, config: HostingerConfig): string | null {
  const prefix = `${config.publicBase}/`;
  if (!url.startsWith(prefix)) return null;
  const key = url.slice(prefix.length);
  return isHostingerKey(key) ? key : null;
}

/** Bounded, so a hung endpoint cannot hold a scan or a publish forever. */
const TIMEOUT_MS = 120_000;

async function readError(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  try {
    const body = JSON.parse(text) as { error?: unknown };
    if (typeof body.error === "string") return body.error;
  } catch {
    // not JSON — fall through
  }
  return text.slice(0, 200) || response.statusText;
}

function httpFailure(status: number, message: string): StorageFailure {
  if (status === 401 || status === 403)
    return failure("rejected", `Upload endpoint refused the token: ${message}`);
  if (status === 404) return failure("not_found", message);
  if (status === 413 || status === 415 || status === 400) return failure("rejected", message);
  return failure("error", `Upload endpoint answered ${status}: ${message}`);
}

export function hostingerDriver(config: HostingerConfig | null = hostingerConfig()): StorageDriver {
  const notConfigured = () => failure("missing", HOSTINGER_NOT_CONFIGURED);
  const deleteUrl = (c: HostingerConfig) => new URL("delete.php", c.uploadUrl).toString();
  const urlOf = (c: HostingerConfig, key: string) => `${c.publicBase}/${key}`;

  return {
    name: "hostinger",

    publicUrl(key) {
      return config ? urlOf(config, key) : "";
    },

    async put(key, data, options = {}) {
      if (!config) return notConfigured();
      try {
        const bytes = Buffer.isBuffer(data) ? data : await readFile(data.file);
        const form = new FormData();
        const blob = new Blob([new Uint8Array(bytes)], {
          type: options.mime ?? "application/octet-stream",
        });
        form.append("file", blob, path.posix.basename(key) || "file");
        const response = await fetch(config.uploadUrl, {
          method: "POST",
          headers: { authorization: `Bearer ${config.token}` },
          body: form,
          signal: AbortSignal.timeout(
            Math.min(TIMEOUT_MS, Math.max(1, options.timeoutMs ?? TIMEOUT_MS)),
          ),
        });
        if (!response.ok) return httpFailure(response.status, await readError(response));
        const body = (await response.json()) as { path?: unknown; url?: unknown };
        if (typeof body.path !== "string" || !isHostingerKey(body.path)) {
          return failure("error", "Upload endpoint returned no usable path.");
        }
        return { ok: true, key: body.path, url: urlOf(config, body.path), bytes: bytes.length };
      } catch (error) {
        return failure("error", `Upload failed: ${(error as Error).message}`);
      }
    },

    async get(key) {
      if (!config) return notConfigured();
      if (!isHostingerKey(key)) return failure("rejected", `Not a public media key: ${key}`);
      try {
        const response = await fetch(urlOf(config, key), {
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!response.ok) return httpFailure(response.status, response.statusText);
        return {
          ok: true,
          data: Buffer.from(await response.arrayBuffer()),
          mime: response.headers.get("content-type") ?? undefined,
        };
      } catch (error) {
        return failure("error", (error as Error).message);
      }
    },

    async exists(key) {
      if (!config) return notConfigured();
      if (!isHostingerKey(key)) return failure("rejected", `Not a public media key: ${key}`);
      try {
        const response = await fetch(urlOf(config, key), {
          method: "HEAD",
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (response.status === 404) return { ok: true, exists: false };
        if (!response.ok) return httpFailure(response.status, response.statusText);
        return { ok: true, exists: true };
      } catch (error) {
        return failure("error", (error as Error).message);
      }
    },

    async remove(key) {
      if (!config) return notConfigured();
      if (!isHostingerKey(key)) return failure("rejected", `Not a public media key: ${key}`);
      try {
        const response = await fetch(deleteUrl(config), {
          method: "POST",
          headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json" },
          body: JSON.stringify({ path: key }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!response.ok) return httpFailure(response.status, await readError(response));
        const body = (await response.json()) as { removed?: unknown };
        return { ok: true, removed: body.removed === true };
      } catch (error) {
        return failure("error", (error as Error).message);
      }
    },
  };
}
