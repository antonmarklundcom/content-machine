/**
 * The tolerant cuentos book parser (build 4 §3.C.1). Pure: `loadBook` reads
 * the folder, this turns what it read into scenes.
 *
 * The real repo's formats drift (skills write story.json by hand, recorders
 * fill art/manifest.json, languages/ and audio/ have no fixed shape), so the
 * rule is: read what is understood, and put everything else in the report.
 * Nothing is dropped silently and no text is ever invented — a `null` language
 * stays null, and a language file never overrides story.json.
 */
import type { StorySceneKind } from "@/db/schema";
import { normalizeStatus } from "./rules";
import type { BookFiles, BookJsonFile, ParsedScene, ParsedStory, StoryLine } from "./types";

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | null {
  if (typeof v === "string") return v.trim() ? v : null;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

function first(o: Obj, keys: string[]): unknown {
  for (const k of keys) if (k in o && o[k] !== undefined) return o[k];
  return undefined;
}

/** `es-PY` → `es`, `Jopará` → `jopara`, `grn` → `gn`. Null for something that is not a language key. */
export function normalizeLang(raw: string): string | null {
  const s = raw.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (!s) return null;
  if (
    s === "es" ||
    s === "es-py" ||
    s === "es_py" ||
    s === "spa" ||
    s === "castellano" ||
    s === "espanol"
  )
    return "es";
  if (s === "gn" || s === "grn" || s === "gn-py" || s === "guarani") return "gn";
  if (s === "jopara" || s === "jop") return "jopara";
  if (s === "en" || s === "eng" || s === "english" || s.startsWith("en-")) return "en";
  if (s === "pt" || s === "pt-br") return "pt";
  if (/^[a-z]{2}$/.test(s)) return s;
  return null;
}

const LANG_ORDER = ["es", "jopara", "gn", "en"];
function sortLangs(langs: Iterable<string>): string[] {
  return [...new Set(langs)].sort((a, b) => {
    const ia = LANG_ORDER.indexOf(a);
    const ib = LANG_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });
}

/** A per-language value: a string, or `{ es: "…" }` (first of es/preferred, else first string). */
function pickText(v: unknown, prefer = "es"): string | null {
  if (typeof v === "string") return str(v);
  if (isObj(v)) {
    const direct = str(v[prefer]);
    if (direct) return direct;
    for (const val of Object.values(v)) {
      const s = str(val);
      if (s) return s;
    }
  }
  return null;
}

/** A scene id as written; `S1` and `s01` stay as they are — ids are matched exactly, then case-insensitively. */
function sceneIdOf(o: Obj): string | null {
  return str(
    first(o, ["id", "sceneId", "scene_id", "sceneRef", "pageId", "ref", "planId", "plan"]),
  );
}

/**
 * Comparison key for a scene id. The repo writes the same scene as `S01` in
 * story.json and `S001` in audio scripts and Guaraní drafts, and some
 * manifests key art by page number: `S01`, `S001`, `s1` and `1` are one scene.
 */
export function sceneKey(id: string): string {
  const t = id.trim().toUpperCase();
  const m = /^S?0*(\d+)$/.exec(t);
  return m ? `S${Number(m[1])}` : t;
}

const SCENE_KINDS: StorySceneKind[] = ["page", "cover", "back"];

const KNOWN_STORY_KEYS = new Set([
  "title",
  "subtitle",
  "slug",
  "id",
  "pages",
  "scenes",
  "spreads",
  "series",
  "seriesId",
  "age",
  "ageBand",
  "age_band",
  "audience",
  "questions",
  "activity",
  "coverBrief",
  "design",
  "referenceIds",
  "author",
  "authors",
  "credits",
  "language",
  "languages",
  "status",
  "version",
  "notes",
  "summary",
  "synopsis",
  "dedication",
  "characters",
  "cast",
  "tags",
  "createdAt",
  "updatedAt",
]);

const KNOWN_PAGE_KEYS = new Set([
  "id",
  "sceneId",
  "scene_id",
  "sceneRef",
  "pageId",
  "ref",
  "kind",
  "type",
  "text",
  "textStatus",
  "status",
  "artBrief",
  "alt",
  "lines",
  "notes",
  "characters",
  "referenceIds",
  "layout",
  "spread",
  "page",
  "number",
  // Read since the real repo was checked (2026-10-07): the page's own art.
  "art",
  // Layout and production fields: kept in the raw snapshot, not needed for voice/video.
  "textZone",
  "parentCue",
  "artCast",
  "chapter",
  "artStatus",
  "generationPlanId",
  "dialoguePresentation",
  "translation",
  "translationStatus",
]);

const KNOWN_BOOK_ENTRIES = new Set([
  "story.json",
  "art",
  "languages",
  "audio",
  "VIDEO-PLAN.md",
  "HANDOFF.md",
  "README.md",
  "references",
  "characters",
  "export",
  "exports",
  "reader",
  "pdf",
  "video",
  "notes",
]);

/** A language-keyed text field: `{ es, gn, … }`, a bare string (taken as `es`, with a warning), or `{ es: { text, status } }`. */
function readTextField(
  raw: unknown,
  sceneRef: string,
  warn: (m: string) => void,
): { text: Record<string, string | null>; status: Record<string, string> } {
  const text: Record<string, string | null> = {};
  const status: Record<string, string> = {};
  if (raw === undefined) return { text, status };
  if (typeof raw === "string") {
    warn(`${sceneRef}: "text" is a plain string; read as Spanish (es).`);
    text.es = raw;
    return { text, status };
  }
  if (!isObj(raw)) {
    warn(`${sceneRef}: "text" is not an object or string; ignored.`);
    return { text, status };
  }
  for (const [key, val] of Object.entries(raw)) {
    const lang = normalizeLang(key);
    if (!lang) {
      warn(`${sceneRef}: text key "${key}" is not a language; ignored.`);
      continue;
    }
    if (
      typeof text[lang] === "string" &&
      (val === null || (typeof val === "string" && !val.trim()))
    ) {
      warn(`${sceneRef}: text.${key} is empty but another key gives ${lang} text; kept the text.`);
      continue;
    }
    if (val === null) text[lang] = null;
    else if (typeof val === "string") text[lang] = val.trim() ? val : null;
    else if (isObj(val) && (typeof val.text === "string" || val.text === null)) {
      text[lang] = typeof val.text === "string" && val.text.trim() ? val.text : null;
      const s = str(first(val, ["status", "textStatus", "review", "reviewStatus"]));
      if (s) status[lang] = s;
    } else warn(`${sceneRef}: text.${key} has an unexpected shape; ignored.`);
  }
  return { text, status };
}

function readStatusField(
  raw: unknown,
  langs: string[],
  sceneRef: string,
  warn: (m: string) => void,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (raw === undefined || raw === null) return out;
  if (typeof raw === "string") {
    for (const l of langs) out[l] = raw;
    return out;
  }
  if (isObj(raw)) {
    for (const [key, val] of Object.entries(raw)) {
      const lang = normalizeLang(key);
      const s = str(val) ?? (isObj(val) ? str(first(val, ["status", "state"])) : null);
      if (lang && s) out[lang] = s;
      else warn(`${sceneRef}: textStatus.${key} not understood; ignored.`);
    }
    return out;
  }
  warn(`${sceneRef}: textStatus has an unexpected shape; ignored.`);
  return out;
}

function speakerOf(raw: unknown): string | null {
  const s = str(raw);
  if (!s) return null;
  const n = s.trim().toLowerCase();
  if (
    ["narrator", "narrador", "narradora", "narration", "narracion", "narración", "voz"].includes(n)
  )
    return null;
  return s.trim();
}

function readLines(raw: unknown): StoryLine[] | null {
  if (!Array.isArray(raw)) return null;
  const out: StoryLine[] = [];
  for (const item of raw) {
    if (typeof item === "string") {
      if (item.trim()) out.push({ speaker: null, text: item });
    } else if (isObj(item)) {
      const text = str(item.text);
      if (text)
        out.push({
          speaker: speakerOf(first(item, ["speaker", "character", "voice", "role"])),
          text,
        });
    }
  }
  return out;
}

/** Letters and digits only, lower-case: does a split of the text still say exactly the text? */
function speechKey(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

// ---------------------------------------------------------------------------
// Art manifest

type ArtCandidate = {
  planId: string;
  path: string;
  selected: boolean;
  when: number;
  order: number;
};

function readArtEntries(manifest: unknown, warn: (m: string) => void): Obj[] {
  if (manifest === undefined) return [];
  if (Array.isArray(manifest)) return manifest.filter(isObj);
  if (isObj(manifest)) {
    const list = first(manifest, ["entries", "items", "images", "pages", "art", "records", "jobs"]);
    if (Array.isArray(list)) return list.filter(isObj);
    // Keyed by plan id: { "S01": {…} | [{…}] }
    const out: Obj[] = [];
    for (const [k, v] of Object.entries(manifest)) {
      const items = Array.isArray(v) ? v : [v];
      for (const it of items) if (isObj(it)) out.push({ planId: k, ...it });
    }
    if (out.length) return out;
  }
  warn("art/manifest.json has an unexpected shape; no art read from it.");
  return [];
}

const SELECTED_STATES = ["selected", "approved", "final", "chosen", "picked", "accepted"];
const REJECTED_STATES = ["rejected", "discarded", "failed", "deleted", "superseded", "error"];

/** A manifest path as a path relative to CUENTOS_ROOT, or null when it climbs out or is unusable. */
export function artPathFromManifest(raw: string, slug: string): string | null {
  const p = raw.replace(/\\/g, "/").trim();
  if (!p || p.split("/").includes("..")) return null;
  const marker = `/books/${slug}/`;
  const i = p.toLowerCase().lastIndexOf(marker.toLowerCase());
  if (i >= 0) return `books/${slug}/${p.slice(i + marker.length)}`;
  if (/^[a-zA-Z]:\//.test(p) || p.startsWith("/")) return null;
  if (p.startsWith(`books/${slug}/`)) return p;
  return `books/${slug}/${p.replace(/^\.\//, "")}`;
}

function chooseArt(
  files: BookFiles,
  sceneIds: Set<string>,
  warn: (m: string) => void,
): Map<string, string> {
  const entries = readArtEntries(files.artManifest, warn);
  const fileSet = new Set(files.files.map((f) => f.toLowerCase()));
  const bookPrefix = `books/${files.slug}/`;
  const bySceneKey = new Map<string, ArtCandidate[]>();
  const unusedPlans = new Map<string, number>();

  entries.forEach((e, order) => {
    const planId = str(
      first(e, [
        "planId",
        "plan",
        "plan_id",
        "id",
        "sceneId",
        "scene",
        "page",
        "index",
        "target",
        "ref",
      ]),
    );
    const rawPath = str(
      first(e, [
        "file",
        "path",
        "localPath",
        "local_path",
        "local",
        "output",
        "src",
        "image",
        "filePath",
      ]),
    );
    if (!planId) {
      warn(`art/manifest.json entry #${order + 1} has no plan id; ignored.`);
      return;
    }
    const key = sceneKey(planId);
    if (!sceneIds.has(key)) {
      unusedPlans.set(planId, (unusedPlans.get(planId) ?? 0) + 1);
      return;
    }
    if (!rawPath) {
      warn(`art/manifest.json entry for ${planId} has no file path; ignored.`);
      return;
    }
    const state = normalizeStatus(str(first(e, ["status", "state", "review"])));
    const rejected = e.rejected === true || (state !== null && REJECTED_STATES.includes(state));
    if (rejected) return;
    const selected = e.selected === true || (state !== null && SELECTED_STATES.includes(state));
    const whenRaw = first(e, [
      "selectedAt",
      "createdAt",
      "recordedAt",
      "downloadedAt",
      "date",
      "timestamp",
      "at",
    ]);
    const when =
      typeof whenRaw === "number"
        ? whenRaw
        : typeof whenRaw === "string"
          ? Date.parse(whenRaw) || 0
          : 0;
    const rel = artPathFromManifest(rawPath, files.slug);
    if (!rel) {
      warn(`art/manifest.json path for ${planId} is outside the book ("${rawPath}"); ignored.`);
      return;
    }
    const list = bySceneKey.get(key) ?? [];
    list.push({ planId, path: rel, selected, when, order });
    bySceneKey.set(key, list);
  });

  for (const [planId, n] of unusedPlans) {
    warn(
      `art/manifest.json has ${n} entr${n === 1 ? "y" : "ies"} for "${planId}", which is not a scene; not used.`,
    );
  }

  const chosen = new Map<string, string>();
  for (const [key, list] of bySceneKey) {
    // Selected first, then newest (by time, then by position in the manifest).
    const ordered = [...list].sort(
      (a, b) => Number(b.selected) - Number(a.selected) || b.when - a.when || b.order - a.order,
    );
    const present = ordered.find((c) => fileSet.has(c.path.slice(bookPrefix.length).toLowerCase()));
    if (!present) {
      warn(`${list[0].planId}: art in the manifest is not on disk (${ordered[0].path}).`);
      continue;
    }
    if (present !== ordered[0]) {
      warn(
        `${present.planId}: preferred art ${ordered[0].path} is missing; using ${present.path}.`,
      );
    }
    chosen.set(key, present.path);
  }
  return chosen;
}

// ---------------------------------------------------------------------------
// languages/ and audio/

function langFromPath(path: string, dir: "languages" | "audio"): string | null {
  const parts = path.split("/");
  const at = parts.indexOf(dir);
  const rest = parts.slice(at + 1);
  if (rest.length > 1) {
    const fromDir = normalizeLang(rest[0]);
    if (fromDir) return fromDir;
  }
  const stem = rest[rest.length - 1].replace(/\.(json|tsv)$/i, "");
  const direct = normalizeLang(stem);
  if (direct) return direct;
  for (const piece of stem.split(/[._-]+/).reverse()) {
    const l = normalizeLang(piece);
    if (l && piece.length <= 6) return l;
  }
  return null;
}

type LangEntry = { id: string; text: string | null; status: string | null };

function readLanguageEntries(
  data: unknown,
  langHint: string | null = null,
): {
  entries: LangEntry[];
  status: string | null;
  lang: string | null;
} {
  const entries: LangEntry[] = [];
  let status: string | null = null;
  let lang: string | null = null;
  let body: unknown = data;
  if (isObj(data)) {
    status = str(first(data, ["status", "textStatus", "reviewStatus", "review"]));
    const l = str(first(data, ["lang", "language", "locale"]));
    lang = l ? normalizeLang(l) : null;
    const inner = first(data, ["pages", "scenes", "text", "texts", "entries"]);
    if (inner !== undefined) body = inner;
  }
  const push = (id: string | null, v: unknown) => {
    if (!id) return;
    if (v === null) entries.push({ id, text: null, status: null });
    else if (typeof v === "string") entries.push({ id, text: v.trim() ? v : null, status: null });
    else if (isObj(v)) {
      // `{ id, es, gn }` rows (languages/gn.draft.json): the file's language is a key.
      const key = lang ?? langHint;
      const t = first(v, key ? ["text", "body", "value", key] : ["text", "body", "value"]);
      const text = typeof t === "string" ? (t.trim() ? t : null) : null;
      const s = str(first(v, ["status", "textStatus", "reviewStatus", "review", "approval"]));
      if (typeof t === "string" || t === null) entries.push({ id, text, status: s });
    }
  };
  if (Array.isArray(body)) {
    for (const item of body) if (isObj(item)) push(sceneIdOf(item), item);
  } else if (isObj(body)) {
    for (const [k, v] of Object.entries(body)) {
      if (
        [
          "status",
          "textStatus",
          "reviewStatus",
          "lang",
          "language",
          "locale",
          "title",
          "notes",
        ].includes(k)
      )
        continue;
      push(k, v);
    }
  }
  return { entries, status, lang };
}

type AudioEntry = { id: string; speaker: string | null; text: string; lang: string | null };

function readAudioEntries(data: unknown): { entries: AudioEntry[]; lang: string | null } {
  const entries: AudioEntry[] = [];
  let lang: string | null = null;
  let body: unknown = data;
  if (isObj(data)) {
    const l = str(first(data, ["lang", "language", "locale"]));
    lang = l ? normalizeLang(l) : null;
    const inner = first(data, [
      "lines",
      "entries",
      "script",
      "segments",
      "items",
      "scenes",
      "pages",
    ]);
    if (inner !== undefined) body = inner;
  }
  const pushLine = (id: string | null, item: Obj, inheritedLang: string | null) => {
    const text = str(item.text);
    if (!id || !text) return;
    const l = str(first(item, ["lang", "language", "locale"]));
    entries.push({
      id,
      text,
      speaker: speakerOf(first(item, ["speaker", "character", "voice", "role"])),
      lang: (l ? normalizeLang(l) : null) ?? inheritedLang,
    });
  };
  if (Array.isArray(body)) {
    for (const item of body) {
      if (!isObj(item)) continue;
      const id = str(
        first(item, ["scene", "sceneId", "scene_id", "sceneRef", "id", "page", "pageId"]),
      );
      const nested = first(item, ["lines", "segments"]);
      if (Array.isArray(nested)) {
        const l = str(first(item, ["lang", "language"]));
        for (const n of nested) if (isObj(n)) pushLine(id, n, l ? normalizeLang(l) : null);
      } else pushLine(id, item, null);
    }
  } else if (isObj(body)) {
    // { S01: [ {speaker, text} ] }
    for (const [k, v] of Object.entries(body)) {
      if (Array.isArray(v)) for (const n of v) if (isObj(n)) pushLine(k, n, null);
    }
  }
  return { entries, lang };
}

// ---------------------------------------------------------------------------

/** Parse one book. Never throws on content: what it cannot read goes into `report`. */
export function parseBook(files: BookFiles): ParsedStory {
  const warnings: string[] = [];
  const unknownFiles: string[] = [];
  const warn = (m: string) => warnings.push(m);
  const story = isObj(files.story) ? files.story : {};
  if (!isObj(files.story)) warn("story.json is not an object.");

  const title = pickText(story.title) ?? files.slug;
  if (!pickText(story.title)) warn("story.json has no title; using the folder name.");
  const seriesRaw = first(story, ["series", "seriesId"]);
  const series = pickText(isObj(seriesRaw) && "name" in seriesRaw ? seriesRaw.name : seriesRaw);
  const ageRaw = first(story, ["ageBand", "age_band", "age", "audience"]);
  let ageBand: string | null = null;
  if (isObj(ageRaw) && ("min" in ageRaw || "max" in ageRaw)) {
    ageBand = `${str(ageRaw.min) ?? "0"}-${str(ageRaw.max) ?? "+"}`;
  } else ageBand = pickText(ageRaw);

  const unknownTop = Object.keys(story).filter((k) => !KNOWN_STORY_KEYS.has(k));
  if (unknownTop.length)
    warn(`story.json keys not read: ${unknownTop.join(", ")} (kept in the raw snapshot).`);

  const pagesRaw = first(story, ["pages", "scenes", "spreads"]);
  const pages = Array.isArray(pagesRaw) ? pagesRaw : [];
  if (!Array.isArray(pagesRaw)) warn("story.json has no pages or scenes array.");

  const scenes: ParsedScene[] = [];
  const seen = new Map<string, number>();
  /** The page's own `art` path (relative to the book): the book's declared selection. */
  const pageArt = new Map<string, string>();
  const unknownPageKeys = new Set<string>();
  pages.forEach((p, i) => {
    if (!isObj(p)) {
      warn(`Page #${i + 1} is not an object; skipped.`);
      return;
    }
    let sceneRef = sceneIdOf(p);
    if (!sceneRef) {
      sceneRef = `S${String(i + 1).padStart(2, "0")}`;
      warn(`Page #${i + 1} has no id; using ${sceneRef}.`);
    }
    if (seen.has(sceneKey(sceneRef))) {
      warn(`Duplicate scene id ${sceneRef} (page #${i + 1}); skipped.`);
      return;
    }
    seen.set(sceneKey(sceneRef), scenes.length);
    for (const k of Object.keys(p)) if (!KNOWN_PAGE_KEYS.has(k)) unknownPageKeys.add(k);
    const declaredArt = str(p.art);
    if (declaredArt) pageArt.set(sceneKey(sceneRef), declaredArt);

    const kindRaw = (str(first(p, ["kind", "type"])) ?? "").toLowerCase();
    const kind: StorySceneKind = (SCENE_KINDS as string[]).includes(kindRaw)
      ? (kindRaw as StorySceneKind)
      : /^cover$/i.test(sceneRef)
        ? "cover"
        : "page";

    const { text, status: inlineStatus } = readTextField(p.text, sceneRef, warn);
    const langs = Object.keys(text);
    const statusRaw = p.textStatus !== undefined ? p.textStatus : p.status;
    const textStatus = { ...readStatusField(statusRaw, langs, sceneRef, warn), ...inlineStatus };

    const lines: Record<string, StoryLine[]> = {};
    if (p.lines !== undefined) {
      if (Array.isArray(p.lines)) {
        const l = readLines(p.lines);
        if (l?.length) lines.es = l;
      } else if (isObj(p.lines)) {
        for (const [k, v] of Object.entries(p.lines)) {
          const lang = normalizeLang(k);
          const l = readLines(v);
          if (lang && l?.length) lines[lang] = l;
        }
      }
    }

    scenes.push({
      sceneRef,
      position: scenes.length + 1,
      kind,
      text,
      textStatus,
      lines,
      artPath: null,
      alt: pickText(p.alt),
      artBrief: pickText(p.artBrief, "en"),
    });
  });
  if (unknownPageKeys.size) warn(`Page keys not read: ${[...unknownPageKeys].sort().join(", ")}.`);

  const findScene = (id: string) => {
    const idx = seen.get(sceneKey(id));
    return idx === undefined ? undefined : scenes[idx];
  };

  // languages/ — separate per-language assets fill languages story.json leaves empty.
  for (const file of files.languageFiles) {
    if ("error" in file) {
      warn(`${file.path}: not valid JSON (${file.error}).`);
      unknownFiles.push(file.path);
      continue;
    }
    const hint = langFromPath(file.path, file.path.startsWith("audio/") ? "audio" : "languages");
    const parsed = readLanguageEntries(file.data, hint);
    const lang = parsed.lang ?? hint;
    if (!lang || !parsed.entries.length) {
      unknownFiles.push(file.path);
      continue;
    }
    let used = 0;
    for (const e of parsed.entries) {
      const scene = findScene(e.id);
      if (!scene) {
        warn(`${file.path}: ${e.id} is not a scene; ignored.`);
        continue;
      }
      const current = scene.text[lang];
      if (typeof current === "string") {
        if (e.text !== null && e.text.trim() !== current.trim()) {
          warn(`${file.path}: ${scene.sceneRef} ${lang} differs from story.json; story.json kept.`);
        }
        continue;
      }
      if (e.text === null) {
        if (!(lang in scene.text)) scene.text[lang] = null;
        continue;
      }
      scene.text[lang] = e.text;
      const s = e.status ?? parsed.status;
      if (s) scene.textStatus[lang] = s;
      else delete scene.textStatus[lang];
      used++;
    }
    if (!used)
      warn(
        `${file.path}: no text used (story.json or an earlier language file already has it, or nothing matched).`,
      );
  }

  // audio/ — narration scripts split a scene's text by speaker.
  const scriptLines = new Map<string, StoryLine[]>(); // `${sceneKey}|${lang}`
  for (const file of files.audioFiles) {
    if (/manifest\.content-engine\.json$/i.test(file.path)) continue; // our own export
    if ("error" in file) {
      warn(`${file.path}: not valid JSON (${file.error}).`);
      unknownFiles.push(file.path);
      continue;
    }
    // The repo's recording tracker (`{ tracks: [{ locale, status, clips }] }`):
    // recording status, not narration text — known, nothing to import.
    if (
      /(^|\/)manifest\.json$/i.test(file.path) &&
      isObj(file.data) &&
      Array.isArray(file.data.tracks)
    )
      continue;
    const parsed = readAudioEntries(file.data);
    if (!parsed.entries.length) {
      unknownFiles.push(file.path);
      continue;
    }
    const fileLang = parsed.lang ?? langFromPath(file.path, "audio");
    for (const e of parsed.entries) {
      const lang = e.lang ?? fileLang;
      const scene = findScene(e.id);
      if (!lang) {
        warn(`${file.path}: a line for ${e.id} has no language; ignored.`);
        continue;
      }
      if (!scene) {
        warn(`${file.path}: ${e.id} is not a scene; ignored.`);
        continue;
      }
      const key = `${sceneKey(scene.sceneRef)}|${lang}`;
      const list = scriptLines.get(key) ?? [];
      list.push({ speaker: e.speaker, text: e.text });
      scriptLines.set(key, list);
    }
  }
  for (const [key, list] of scriptLines) {
    const [sk, lang] = key.split("|");
    const scene = findScene(sk);
    if (!scene) continue;
    const text = scene.text[lang];
    if (typeof text !== "string") {
      warn(
        `${scene.sceneRef}: audio script has ${lang} lines but the scene has no ${lang} text; not used.`,
      );
      continue;
    }
    if (speechKey(list.map((l) => l.text).join(" ")) !== speechKey(text)) {
      warn(
        `${scene.sceneRef}: the ${lang} audio script does not say exactly the approved text; narrating the text as one narrator line.`,
      );
      continue;
    }
    scene.lines[lang] = list;
  }
  // Inline lines from story.json must also say the text exactly.
  for (const scene of scenes) {
    for (const [lang, list] of Object.entries(scene.lines)) {
      const text = scene.text[lang];
      if (
        typeof text !== "string" ||
        speechKey(list.map((l) => l.text).join(" ")) !== speechKey(text)
      ) {
        warn(`${scene.sceneRef}: ${lang} lines do not match the text; not used.`);
        delete scene.lines[lang];
      }
    }
  }

  // art/manifest.json → the selected art per scene.
  const art = chooseArt(files, new Set(seen.keys()), warn);
  const onDisk = new Set(files.files.map((f) => f.toLowerCase()));
  const bookPrefix = `books/${files.slug}/`;
  for (const scene of scenes) {
    // The page's own `art` wins when it is on disk; else the manifest's choice.
    const declared = pageArt.get(sceneKey(scene.sceneRef));
    const declaredRel = declared ? artPathFromManifest(declared, files.slug) : null;
    if (declaredRel && onDisk.has(declaredRel.slice(bookPrefix.length).toLowerCase())) {
      scene.artPath = declaredRel;
      const stale = `${scene.sceneRef}: art in the manifest is not on disk`;
      for (let i = warnings.length - 1; i >= 0; i--)
        if (warnings[i].startsWith(stale)) warnings.splice(i, 1);
      continue;
    }
    scene.artPath = art.get(sceneKey(scene.sceneRef)) ?? null;
    if (!scene.artPath && declaredRel) {
      warn(`${scene.sceneRef}: the page's art is not on disk (${declaredRel}).`);
      continue;
    }
    const already = warnings.some((w) => w.startsWith(`${scene.sceneRef}: art in the manifest`));
    if (!scene.artPath && scene.kind === "page" && !already) {
      warn(`${scene.sceneRef}: no selected art.`);
    }
  }

  // Files the importer does not read at all.
  const existingAudio = files.files.filter((f) => /^audio\/.*\.(wav|mp3|m4a|ogg)$/i.test(f));
  if (existingAudio.length) {
    warn(
      `audio/ has ${existingAudio.length} audio file(s) (recordings or earlier exports); not imported.`,
    );
  }
  for (const f of files.files) {
    const top = f.split("/")[0];
    if (!KNOWN_BOOK_ENTRIES.has(top)) unknownFiles.push(f);
    else if (top === "languages" && !/\.json$/i.test(f)) unknownFiles.push(f);
    else if (top === "audio" && !/\.(json|tsv)$/i.test(f) && !/\.(wav|mp3|m4a|ogg)$/i.test(f))
      unknownFiles.push(f);
  }

  const languages = sortLangs(
    scenes.flatMap((s) =>
      Object.entries(s.text)
        .filter(([, v]) => typeof v === "string")
        .map(([k]) => k),
    ),
  );

  return {
    slug: files.slug,
    title,
    series,
    ageBand,
    languages,
    scenes,
    report: { warnings, unknownFiles: [...new Set(unknownFiles)].sort() },
  };
}

/** For tests and the CLI: a parsed JSON file entry. */
/**
 * A tab-separated table with a header row; fields may be double-quoted and
 * span lines (`""` is a quote). The repo's narration scripts use it:
 * `sceneId	page	text	approval	expectedFile` (audio/script.<lang>.tsv).
 */
export function parseTsv(text: string): Array<Record<string, string>> {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === "") quoted = true;
    else if (c === "\t") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f !== "")) rows.push(row);
  const [header, ...body] = rows;
  if (!header) return [];
  const keys = header.map((h) => h.trim());
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i] ?? ""])));
}

/**
 * A narration script table as a language file: one entry per scene with its
 * text and approval status, in the shape `readLanguageEntries` reads.
 */
export function tsvFile(path: string, text: string): BookJsonFile {
  try {
    const pages = parseTsv(text).map((r) => ({
      id: r.sceneId || r.scene || r.id || r.page || "",
      text: r.text ?? "",
      status: r.approval || r.status || null,
    }));
    return { path, data: { pages } };
  } catch (err) {
    return { path, error: err instanceof Error ? err.message : String(err) };
  }
}

export function jsonFile(path: string, text: string): BookJsonFile {
  try {
    return { path, data: JSON.parse(text) as unknown };
  } catch (err) {
    return { path, error: err instanceof Error ? err.message : String(err) };
  }
}
