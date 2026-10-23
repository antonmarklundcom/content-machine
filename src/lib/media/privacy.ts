import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";

import { inside, mediaRoot, resolveMediaFile, splitRelative } from "@/lib/storage/root";
import { localDriver } from "@/lib/storage/local";

/** Personal source material is accessible only through its dedicated owner routes. */
export const PRIVATE_MEDIA_FOLDERS = [
  "voice/_consent",
  "voice/_references",
  "voice/_datasets",
] as const;
const IDENTITY_FOLDER = "_private/media-identities";
const SHARED_IDENTITY_FOLDER = "_private/shared-identities";
const HASH = /^[a-f0-9]{64}$/;
const MAX_PRIVATE_ENTRIES = 50_000;
const fingerprints = new Map<string, { fingerprint: string; sha: string }>();
const inFlight = new Map<string, Promise<Set<string>>>();

export function isPrivateMediaPath(rel: string): boolean {
  const parts = splitRelative(rel);
  if (!parts) return true;
  const normalized = parts.join("/").toLowerCase();
  return (
    normalized === "_private" ||
    normalized.startsWith("_private/") ||
    PRIVATE_MEDIA_FOLDERS.some(
      (folder) => normalized === folder || normalized.startsWith(`${folder}/`),
    )
  );
}

async function hashFile(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

async function readIdentityHashes(folder: string, root: string): Promise<Set<string>> {
  const actual = await realpath(path.join(root, ...folder.split("/"))).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    },
  );
  if (!actual) return new Set();
  if (!inside(await realpath(root), actual))
    throw new Error("Media classification storage must stay inside MEDIA_ROOT.");
  const names = await readdir(actual);
  if (names.length > MAX_PRIVATE_ENTRIES)
    throw new Error(
      "Media classification exceeds its safe identity limit; ask the owner to review storage.",
    );
  return new Set(names.filter((name) => HASH.test(name)));
}

async function recordIdentity(folder: string, sha: string, root: string): Promise<void> {
  const saved = await localDriver(root).put(`${folder}/${sha}`, Buffer.from("classified\n"));
  if (
    !saved.ok &&
    !(saved.reason === "rejected" && saved.message.startsWith("A file already exists"))
  )
    throw new Error(
      "Media classification could not be saved safely. Check storage access and retry.",
    );
}

export function sharedMediaHashes(root = mediaRoot()): Promise<Set<string>> {
  return readIdentityHashes(SHARED_IDENTITY_FOLDER, root);
}

/** Explicit local owner review only; never infer this approval from status, brand or an old asset row. */
export async function approveSharedMediaIdentity(
  sha256: string,
  root = mediaRoot(),
): Promise<void> {
  const sha = sha256.toLowerCase();
  if (!HASH.test(sha)) throw new Error("Review requires the exact SHA256 identity.");
  if ((await privateMediaHashes(root)).has(sha))
    throw new Error("Known private media cannot be approved for shared-library access.");
  await recordIdentity(SHARED_IDENTITY_FOLDER, sha, root);
}

/** A surviving ordinary source establishes provenance only after hash and private-source checks. */
export async function markSharedMediaFile(
  rel: string,
  expectedSha: string,
  root = mediaRoot(),
): Promise<void> {
  if (isInternalMediaPath(rel))
    throw new Error("An internal media copy cannot establish shared provenance.");
  const file = await resolveMediaFile(splitRelative(rel) ?? [], root);
  if (!file)
    throw new Error(
      "The shared source is unavailable; restore it or request an explicit owner review.",
    );
  const actualRel = path
    .relative(await realpath(root), file)
    .split(path.sep)
    .join("/");
  if (isInternalMediaPath(actualRel))
    throw new Error("An internal media alias cannot establish shared provenance.");
  if ((await hashFile(file)) !== expectedSha.toLowerCase())
    throw new Error("The shared source changed while its identity was being reviewed. Scan again.");
  await approveSharedMediaIdentity(expectedSha, root);
}

/**
 * Keep private identities even after a source is removed. Older scans may have
 * copied those same bytes into _originals and generated public-library thumbs;
 * path exclusion alone cannot protect those existing copies.
 * Markers contain no source bytes or names and are created independently, so concurrent
 * requests cannot overwrite each other's privacy decisions. Include _private in
 * backups together with the source folders and immutable originals.
 */
export function privateMediaHashes(root = mediaRoot()): Promise<Set<string>> {
  const key = path.resolve(root);
  const current = inFlight.get(key);
  if (current) return current;
  const pending = collectPrivateMediaHashes(root).finally(() => inFlight.delete(key));
  inFlight.set(key, pending);
  return pending;
}

async function collectPrivateMediaHashes(root: string): Promise<Set<string>> {
  const hashes = await readIdentityHashes(IDENTITY_FOLDER, root);
  const rootReal = await realpath(root);
  const discovered = new Set<string>();
  const visited = new Set<string>();
  let seen = 0;
  async function visit(directory: string): Promise<void> {
    let entries;
    try {
      const actual = await realpath(directory);
      if (!inside(rootReal, actual) || visited.has(actual)) return;
      visited.add(actual);
      entries = await readdir(actual, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      if (++seen > MAX_PRIVATE_ENTRIES)
        throw new Error(
          "Private media classification exceeds its safe scan limit; ask the owner to review storage.",
        );
      const file = path.join(directory, entry.name);
      if (entry.isDirectory() || (entry.isSymbolicLink() && (await stat(file)).isDirectory()))
        await visit(file);
      else {
        const rel = path.relative(root, file).split(path.sep).join("/");
        const safe = await resolveMediaFile(splitRelative(rel) ?? [], root);
        if (safe) {
          const info = await stat(safe);
          const fingerprint = `${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
          const previous = fingerprints.get(safe);
          const sha = previous?.fingerprint === fingerprint ? previous.sha : await hashFile(safe);
          fingerprints.set(safe, { fingerprint, sha });
          discovered.add(sha);
        }
      }
    }
  }
  // Match the same case-insensitive policy on Linux as on Windows.
  for (const voice of (await readdir(root, { withFileTypes: true })).filter(
    (entry) => entry.name.toLowerCase() === "voice",
  )) {
    const voiceFolder = path.join(root, voice.name);
    for (const entry of await readdir(voiceFolder, { withFileTypes: true })) {
      if (PRIVATE_MEDIA_FOLDERS.some((folder) => folder.split("/")[1] === entry.name.toLowerCase()))
        await visit(path.join(voiceFolder, entry.name));
    }
  }
  for (const sha of discovered)
    if (!hashes.has(sha)) await recordIdentity(IDENTITY_FOLDER, sha, root);
  for (const sha of discovered) hashes.add(sha);
  return hashes;
}

export type AssetPrivacy = { sha256: string; localPath?: string | null; sourceRef?: string | null };

export class MediaProvenanceError extends Error {
  constructor() {
    super("Private or unreviewed attached media cannot be shared or exported. Restore its ordinary source and scan again, or ask the owner to review the exact identity.");
    this.name = "MediaProvenanceError";
  }
}

export async function isPrivateAsset(asset: AssetPrivacy, root = mediaRoot()): Promise<boolean> {
  // Compatibility guard for shared-library callers: unknown provenance is also denied.
  return (await assetPrivacy(asset, root)) !== "shared";
}

/** "Unclassified" is denied by every shared-library and publication entry point. */
export async function assetPrivacy(
  asset: AssetPrivacy,
  root = mediaRoot(),
): Promise<"private" | "shared" | "unclassified"> {
  if (asset.localPath && isPrivateMediaPath(asset.localPath)) return "private";
  if (asset.sourceRef && isPrivateMediaPath(asset.sourceRef.replace(/^media[/\\]/i, "")))
    return "private";
  const sha = asset.sha256.toLowerCase();
  if ((await privateMediaHashes(root)).has(sha)) return "private";
  return (await sharedMediaHashes(root)).has(sha) ? "shared" : "unclassified";
}

/** Authoring path access also checks identity aliases and symlinks within MEDIA_ROOT. */
export async function isPrivateMediaFile(rel: string, root = mediaRoot()): Promise<boolean> {
  if (isPrivateMediaPath(rel)) return true;
  const parts = splitRelative(rel);
  const file = parts ? await resolveMediaFile(parts, root) : null;
  if (!file) return false;
  const actualRel = path
    .relative(await realpath(root), file)
    .split(path.sep)
    .join("/");
  if (isPrivateMediaPath(actualRel)) return true;
  if (isInternalMediaPath(actualRel) && !isInternalMediaPath(rel)) return true;
  const hashes = await privateMediaHashes(root);
  // A thumbnail has different bytes, but its name retains the source identity.
  const thumbSha = /(?:^|\/)_thumbs\/[a-f0-9]{2}\/([a-f0-9]{64})\.webp$/i.exec(rel)?.[1];
  return (
    (thumbSha !== undefined &&
      (hashes.has(thumbSha.toLowerCase()) ||
        !(await sharedMediaHashes(root)).has(thumbSha.toLowerCase()))) ||
    hashes.has(await hashFile(file))
  );
}

/** Internal originals and thumbnails are served only through an authorized asset ID. */
export function isInternalMediaPath(rel: string): boolean {
  const parts = splitRelative(rel);
  const first = parts?.[0]?.toLowerCase();
  return isPrivateMediaPath(rel) || first === "_originals" || first === "_thumbs";
}
