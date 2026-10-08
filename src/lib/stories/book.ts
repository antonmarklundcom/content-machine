/**
 * Reading a cuentos book folder from disk (build 4 §3.C.2). Read-only on
 * CUENTOS_ROOT (§1.10): nothing here writes, renames or touches a file there.
 */
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

import { resolveMediaFile, splitRelative } from "@/lib/storage/root";
import { jsonFile, parseBook, tsvFile } from "./parse";
import type { BookFiles, BookJsonFile, ParsedStory } from "./types";

/** CUENTOS_ROOT, resolved, or null when it is not set. */
export function cuentosRoot(): string | null {
  const raw = process.env.CUENTOS_ROOT?.trim();
  return raw ? path.resolve(raw) : null;
}

export class CuentosRootError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CuentosRootError";
  }
}

/** The root, checked: set and a folder with `books/`. */
export async function requireCuentosRoot(): Promise<string> {
  const root = cuentosRoot();
  if (!root) throw new CuentosRootError("CUENTOS_ROOT is not set (Settings → cuentos folder).");
  try {
    const info = await stat(path.join(root, "books"));
    if (!info.isDirectory()) throw new Error();
  } catch {
    throw new CuentosRootError(`No books/ folder under CUENTOS_ROOT (${root}).`);
  }
  return root;
}

/** A book slug is one plain folder name. */
export function isSafeSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9._-]{0,200}$/i.test(slug) && !slug.includes("..");
}

/** Slugs of every `books/<slug>/story.json`, sorted. */
export async function listBookSlugs(root: string): Promise<string[]> {
  const entries = await readdir(path.join(root, "books"), { withFileTypes: true });
  const slugs: string[] = [];
  for (const e of entries) {
    if (!e.isDirectory() || !isSafeSlug(e.name)) continue;
    try {
      const info = await stat(path.join(root, "books", e.name, "story.json"));
      if (info.isFile()) slugs.push(e.name);
    } catch {
      // not a book
    }
  }
  return slugs.sort();
}

const MAX_FILES = 5000;
const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "__pycache__"]);

async function walk(dir: string, rel: string, out: string[], depth: number): Promise<void> {
  if (depth > 6 || out.length >= MAX_FILES) return;
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.name.startsWith(".") || SKIP_DIRS.has(e.name)) continue;
    const childRel = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) await walk(path.join(dir, e.name), childRel, out, depth + 1);
    else if (e.isFile()) out.push(childRel);
    if (out.length >= MAX_FILES) return;
  }
}

async function readTsv(bookDir: string, rel: string): Promise<BookJsonFile> {
  try {
    return tsvFile(rel, await readFile(path.join(bookDir, ...rel.split("/")), "utf8"));
  } catch (err) {
    return { path: rel, error: err instanceof Error ? err.message : String(err) };
  }
}

async function readJson(bookDir: string, rel: string): Promise<BookJsonFile> {
  try {
    return jsonFile(rel, await readFile(path.join(bookDir, ...rel.split("/")), "utf8"));
  } catch (err) {
    return { path: rel, error: err instanceof Error ? err.message : String(err) };
  }
}

export type LoadedBook = {
  parsed: ParsedStory;
  /** story.json verbatim (parsed), for `stories.raw`. */
  raw: unknown;
  /** sha256 of story.json's bytes. */
  sha: string;
  /** Image size per scene ref, read with sharp. */
  artSize: Map<string, { width: number; height: number }>;
};

/** Read and parse `books/<slug>/`. Throws only when story.json itself cannot be read or parsed. */
export async function loadBook(root: string, slug: string): Promise<LoadedBook> {
  if (!isSafeSlug(slug)) throw new CuentosRootError(`Not a book folder name: ${slug}`);
  const bookDir = path.join(root, "books", slug);
  const storyBytes = await readFile(path.join(bookDir, "story.json"));
  const sha = createHash("sha256").update(storyBytes).digest("hex");
  let raw: unknown;
  try {
    raw = JSON.parse(storyBytes.toString("utf8").replace(/^﻿/, ""));
  } catch (err) {
    throw new CuentosRootError(
      `books/${slug}/story.json is not valid JSON: ${err instanceof Error ? err.message : err}`,
    );
  }

  const files: string[] = [];
  await walk(bookDir, "", files, 0);
  const artManifest = files.includes("art/manifest.json")
    ? await readJson(bookDir, "art/manifest.json")
    : undefined;
  const languageFiles = await Promise.all([
    ...files.filter((f) => /^languages\/.+\.json$/i.test(f)).map((f) => readJson(bookDir, f)),
    // Narration script tables (audio/script.<lang>.tsv) carry per-scene text +
    // approval; read as language files, so a Guaraní script fills Guaraní text.
    ...files.filter((f) => /^audio\/.+\.tsv$/i.test(f)).map((f) => readTsv(bookDir, f)),
  ]);
  const audioFiles = await Promise.all(
    files.filter((f) => /^audio\/.+\.json$/i.test(f)).map((f) => readJson(bookDir, f)),
  );

  const book: BookFiles = {
    slug,
    story: raw,
    artManifest: artManifest && "data" in artManifest ? artManifest.data : undefined,
    languageFiles,
    audioFiles,
    files,
  };
  const parsed = parseBook(book);
  if (artManifest && "error" in artManifest) {
    parsed.report.warnings.push(`art/manifest.json is not valid JSON (${artManifest.error}).`);
  }

  const artSize = new Map<string, { width: number; height: number }>();
  for (const scene of parsed.scenes) {
    if (!scene.artPath) continue;
    const file = await resolveCuentosFile(root, scene.artPath);
    if (!file) {
      parsed.report.warnings.push(`${scene.sceneRef}: art ${scene.artPath} cannot be read.`);
      scene.artPath = null;
      continue;
    }
    try {
      const meta = await sharp(file, { animated: false }).metadata();
      const turned = (meta.orientation ?? 1) >= 5;
      const width = (turned ? meta.height : meta.width) ?? 0;
      const height = (turned ? meta.width : meta.height) ?? 0;
      if (width && height) artSize.set(scene.sceneRef, { width, height });
    } catch {
      parsed.report.warnings.push(
        `${scene.sceneRef}: art ${scene.artPath} is not an image sharp can read.`,
      );
    }
  }
  return { parsed, raw, sha, artSize };
}

/**
 * The absolute path of a file under CUENTOS_ROOT, or null: no `..`, no
 * absolute or drive paths, no symlink that resolves outside the root.
 */
export async function resolveCuentosFile(root: string, rel: string): Promise<string | null> {
  const segments = splitRelative(rel);
  return segments ? resolveMediaFile(segments, path.resolve(root)) : null;
}
