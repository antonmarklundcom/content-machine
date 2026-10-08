import { failure, type StorageDriver, type StorageFailure } from "./driver";

/**
 * The read-only Google Drive tier (PLAN.md §1.41, O14).
 *
 * Google Drive for desktop backs up `MEDIA_ROOT` from Anton's PC; the app never
 * uploads to Drive. What the online app (Hostinger) gains is a way to reach a
 * file it cannot see on disk: `assets.drive_file_id` holds the Drive file id,
 * and this driver turns it into a link a person can open, and — when a key or a
 * token is configured — downloads the bytes.
 *
 *   GOOGLE_DRIVE_API_KEY  an API key with the Drive API enabled. Reads only
 *                         files shared as "Anyone with the link". Optional.
 *
 * A caller that holds an OAuth access token (a future `google_drive`
 * integration row) passes `accessToken`; it is preferred over the key and can
 * read private files. Neither set is a normal state: `link()` still works, the
 * byte reads answer `missing` with DRIVE_NOT_CONFIGURED.
 *
 * Keys are Drive file ids. `put` and `remove` always refuse: read-only by
 * design (the read-write driver is §10 backlog).
 */

export type DriveConfig = { apiKey?: string };

export type DriveOptions = {
  /** An OAuth access token with a Drive read scope; null/undefined falls back to the API key. */
  accessToken?: () => Promise<string | null | undefined>;
  /** Injectable for tests. */
  fetch?: typeof fetch;
};

/** The storage interface, with Drive's own name (the shared `name` union predates this driver). */
export type DriveDriver = Omit<StorageDriver, "name" | "publicUrl"> & {
  readonly name: "drive";
  /** A link a signed-in person can open. Not a direct file URL: never hand it to a publisher. */
  link(key: string): string;
};

export const DRIVE_NOT_CONFIGURED =
  "Google Drive reads not configured — set GOOGLE_DRIVE_API_KEY (files shared by link) or connect Google Drive.";

export const DRIVE_READ_ONLY =
  "Google Drive is read-only here: Drive for desktop on the PC does the uploading.";

const API = "https://www.googleapis.com/drive/v3/files";

/** Bounded, so a hung request cannot hold a page forever. */
const TIMEOUT_MS = 60_000;

/** Drive ids are URL-safe base64-ish: letters, digits, `-` and `_`. */
const ID = /^[A-Za-z0-9_-]{10,128}$/;

export function isDriveFileId(value: string): boolean {
  return ID.test(value);
}

export function driveConfig(env: Record<string, string | undefined> = process.env): DriveConfig {
  const apiKey = env.GOOGLE_DRIVE_API_KEY?.trim();
  return apiKey ? { apiKey } : {};
}

/**
 * The file id in a Drive or Docs link, or the input itself when it already is
 * an id; null for anything else. Accepts `/file/d/<id>/…`, `/document/d/<id>`
 * (any Docs editor), `open?id=<id>` and `uc?id=<id>`.
 */
export function driveFileIdFromUrl(input: string): string | null {
  const value = input.trim();
  if (isDriveFileId(value)) return value;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (host !== "drive.google.com" && host !== "docs.google.com") return null;
  const fromPath = /\/d\/([^/]+)/.exec(url.pathname)?.[1];
  const candidate = fromPath ?? url.searchParams.get("id");
  return candidate && isDriveFileId(candidate) ? candidate : null;
}

export function driveViewUrl(id: string): string {
  return `https://drive.google.com/file/d/${encodeURIComponent(id)}/view`;
}

function httpFailure(status: number, message: string): StorageFailure {
  if (status === 404) return failure("not_found", "Not found on Google Drive (or not shared).");
  if (status === 401 || status === 403)
    return failure("rejected", `Google Drive refused the request: ${message}`);
  return failure("error", `Google Drive answered ${status}: ${message}`);
}

async function readError(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  try {
    const body = JSON.parse(text) as { error?: { message?: unknown } };
    if (typeof body.error?.message === "string") return body.error.message;
  } catch {
    // not JSON — fall through
  }
  return text.slice(0, 200) || response.statusText;
}

export function driveDriver(
  config: DriveConfig = driveConfig(),
  options: DriveOptions = {},
): DriveDriver {
  const doFetch = options.fetch ?? fetch;

  /** The request for `id`, authorised by token or key; null when neither is available. */
  async function request(id: string, query: Record<string, string>): Promise<Response | null> {
    const token = (await options.accessToken?.())?.trim();
    if (!token && !config.apiKey) return null;
    const url = new URL(`${API}/${encodeURIComponent(id)}`);
    url.searchParams.set("supportsAllDrives", "true");
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    const headers: Record<string, string> = {};
    if (token) headers.authorization = `Bearer ${token}`;
    else url.searchParams.set("key", config.apiKey!);
    return doFetch(url.toString(), { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  }

  const badKey = (key: string) => failure("rejected", `Not a Google Drive file id: ${key}`);

  return {
    name: "drive",

    link(key) {
      return driveViewUrl(key);
    },

    async put() {
      return failure("rejected", DRIVE_READ_ONLY);
    },

    async remove() {
      return failure("rejected", DRIVE_READ_ONLY);
    },

    async get(key) {
      if (!isDriveFileId(key)) return badKey(key);
      try {
        const response = await request(key, { alt: "media" });
        if (!response) return failure("missing", DRIVE_NOT_CONFIGURED);
        if (!response.ok) return httpFailure(response.status, await readError(response));
        return {
          ok: true,
          data: Buffer.from(await response.arrayBuffer()),
          mime: response.headers.get("content-type") ?? undefined,
        };
      } catch (error) {
        return failure("error", `Google Drive read failed: ${(error as Error).message}`);
      }
    },

    async exists(key) {
      if (!isDriveFileId(key)) return badKey(key);
      try {
        const response = await request(key, { fields: "id,trashed" });
        if (!response) return failure("missing", DRIVE_NOT_CONFIGURED);
        if (response.status === 404) return { ok: true, exists: false };
        if (!response.ok) return httpFailure(response.status, await readError(response));
        const body = (await response.json()) as { trashed?: unknown };
        return { ok: true, exists: body.trashed !== true };
      } catch (error) {
        return failure("error", `Google Drive read failed: ${(error as Error).message}`);
      }
    },
  };
}
