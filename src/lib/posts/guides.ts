import { readFile } from "node:fs/promises";
import path from "node:path";

import { assertGeneratableLanguage, withLanguageRules } from "@/lib/glossary/prompt";

/**
 * The editable know-how a post prompt includes (PLAN.md §1.46–§1.47): the
 * platform's engagement playbook (`content/playbooks/<platform>.md`) and the
 * language's style guide (`content/style/<file>.md`). Files, not code, so
 * Anton edits them without a deploy; read fresh on every call so an edit
 * applies to the next run.
 */

/** Platforms with their own playbook. Anything else reads the Instagram one (§1.46). */
const PLAYBOOKS: Record<string, string> = {
  instagram: "instagram.md",
  tiktok: "tiktok.md",
  facebook: "facebook.md",
  // Short vertical video everywhere follows the same rules as TikTok.
  youtube: "tiktok.md",
  threads: "instagram.md",
};

export function playbookFile(platform: string): string {
  return PLAYBOOKS[platform.toLowerCase()] ?? "instagram.md";
}

/**
 * Style guides by language tag. The most specific match wins (`es-PY` has its
 * own guide; `es-AR` falls back to neutral `es`); an unknown language gets
 * English, the one guide every run can read.
 */
const STYLE_GUIDES: Record<string, string> = {
  en: "en.md",
  es: "es.md",
  "es-py": "es-PY.md",
  jopara: "jopara.md",
  // Human rules only: Guaraní is never generated (build 4 §1.2).
  gn: "gn.md",
  pt: "pt-BR.md",
  "pt-br": "pt-BR.md",
  de: "de.md",
  nl: "nl.md",
  sv: "sv.md",
};

export function styleGuideFile(language: string): string {
  const tag = language.trim().toLowerCase();
  return STYLE_GUIDES[tag] ?? STYLE_GUIDES[tag.split("-")[0]] ?? "en.md";
}

/** Human names for the prompt; the tag itself is what is stored. */
const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  es: "Spanish (neutral Latin American, tú)",
  "es-py": "Paraguayan Spanish (castellano paraguayo, voseo)",
  jopara: "Jopara (Paraguayan Spanish with common Guaraní words mixed in)",
  gn: "Guaraní",
  pt: "Brazilian Portuguese",
  "pt-br": "Brazilian Portuguese",
  de: "German",
  nl: "Dutch",
  sv: "Swedish",
};

export function languageName(language: string): string {
  const tag = language.trim().toLowerCase();
  return LANGUAGE_NAMES[tag] ?? LANGUAGE_NAMES[tag.split("-")[0]] ?? language;
}

async function readContent(...segments: string[]): Promise<string> {
  try {
    return await readFile(path.join(process.cwd(), "content", ...segments), "utf8");
  } catch {
    // A missing file degrades the prompt; it does not stop a paid run from
    // being useful — the language and platform instructions alone still carry.
    return "";
  }
}

export function loadPlaybook(platform: string): Promise<string> {
  return readContent("playbooks", playbookFile(platform));
}

/**
 * The guide the model gets. Jopará gets the approved Guaraní words appended;
 * pure Guaraní (`gn`) is refused — people write it (build 4 §1.2).
 */
export async function loadPostStyleGuide(language: string): Promise<string> {
  assertGeneratableLanguage(language);
  return withLanguageRules(language, await readContent("style", styleGuideFile(language)));
}
