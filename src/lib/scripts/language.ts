import { readFile } from "node:fs/promises";
import path from "node:path";

import { withLanguageRules } from "@/lib/glossary/prompt";

import { SCRIPT_LANGUAGES, type ScriptLanguage } from "./contract";

/**
 * Which language a script is written in, and the style guide that goes with
 * it (PLAN.md §1.33). The guides are files under `content/style/` so Anton can
 * edit them without touching code; the prompt includes the whole file.
 */

const STYLE_FILES: Record<ScriptLanguage, string> = {
  en: "en.md",
  "es-PY": "es-PY.md",
  jopara: "jopara.md",
};

export function isScriptLanguage(value: unknown): value is ScriptLanguage {
  return typeof value === "string" && (SCRIPT_LANGUAGES as readonly string[]).includes(value);
}

/**
 * Residency and real estate default to English — their audience is foreigners
 * looking at Paraguay (§1.33). Everything else follows the brand's language:
 * Spanish means Paraguayan Spanish. Any run can override this.
 */
const ENGLISH_FIRST_NICHE = /residen|immigra|visa|real estate|inmobil|propert/i;

export function defaultScriptLanguage(brand: { niche: string; language: string }): ScriptLanguage {
  if (ENGLISH_FIRST_NICHE.test(brand.niche)) return "en";
  if (brand.language.toLowerCase().startsWith("es")) return "es-PY";
  return "en";
}

/** The style guide for `language`, read fresh each call so an edit applies to the next run. */
export async function loadStyleGuide(language: ScriptLanguage): Promise<string> {
  const file = path.join(process.cwd(), "content", "style", STYLE_FILES[language]);
  let guide = "";
  try {
    guide = await readFile(file, "utf8");
  } catch {
    // A missing guide degrades the prompt, it does not stop a paid run from
    // being useful; the language instruction alone still carries.
  }
  // Jopará gets the approved Guaraní words appended (build 4 §1.2). There is
  // no `gn` script language: pure Guaraní is written by people.
  return withLanguageRules(language, guide);
}

/**
 * Facts that must be checked against their source before Anton says them on
 * camera: law, residency and migration rules, tax, and prices/fees — the
 * things that change and that a viewer acts on. The model sets the flag too;
 * this is the floor under it, so a claim like "the fee is 1.2 million
 * guaraníes" is flagged even when the model forgot.
 */
const VERIFY_PATTERN =
  /\b(law|ley|decree|decreto|resoluci[oó]n|regulation|residen\w*|migraci\w*|immigra\w*|visa\w*|permit\w*|cédula|cedula|tax\w*|impuest\w*|tribut\w*|iva|fee\w*|arancel\w*|price\w*|precio\w*|cost\w*|costo\w*|deadline\w*|plazo\w*|requirement\w*|requisit\w*|legal\w*|court|tribunal|contract\w*|contrato\w*)\b|[$€₲]|\bgs\.?\s?\d|\busd\b|\d+\s?(%|days|días|dias)/i;

export function needsVerification(claim: string, modelSaid: boolean): boolean {
  return modelSaid || VERIFY_PATTERN.test(claim);
}
