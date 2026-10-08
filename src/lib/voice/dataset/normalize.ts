/**
 * The `normalized_text` column of metadata.csv: numbers spelled out for
 * Spanish only (es, es-PY, jopara use Spanish numerals); every other language
 * keeps the text as written. Pure.
 */

const UNITS = [
  "cero",
  "uno",
  "dos",
  "tres",
  "cuatro",
  "cinco",
  "seis",
  "siete",
  "ocho",
  "nueve",
  "diez",
  "once",
  "doce",
  "trece",
  "catorce",
  "quince",
  "dieciséis",
  "diecisiete",
  "dieciocho",
  "diecinueve",
  "veinte",
  "veintiuno",
  "veintidós",
  "veintitrés",
  "veinticuatro",
  "veinticinco",
  "veintiséis",
  "veintisiete",
  "veintiocho",
  "veintinueve",
];
const TENS = [
  "",
  "",
  "",
  "treinta",
  "cuarenta",
  "cincuenta",
  "sesenta",
  "setenta",
  "ochenta",
  "noventa",
];
const HUNDREDS = [
  "",
  "ciento",
  "doscientos",
  "trescientos",
  "cuatrocientos",
  "quinientos",
  "seiscientos",
  "setecientos",
  "ochocientos",
  "novecientos",
];

function below1000(n: number): string {
  if (n < 30) return UNITS[n];
  if (n < 100) {
    const t = Math.floor(n / 10);
    const u = n % 10;
    return u ? `${TENS[t]} y ${UNITS[u]}` : TENS[t];
  }
  if (n === 100) return "cien";
  const h = Math.floor(n / 100);
  const rest = n % 100;
  return rest ? `${HUNDREDS[h]} ${below1000(rest)}` : HUNDREDS[h];
}

/** "veintiuno mil" → "veintiún mil", "uno" before a noun-like multiplier → "ún". */
function apocope(words: string): string {
  return words.replace(/veintiuno$/, "veintiún").replace(/uno$/, "un");
}

/** A non-negative integer below 10^12 in Spanish words ("uno", not "un"). */
export function spellNumberEs(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n >= 1e12) return String(n);
  if (n < 1000) return below1000(n);
  if (n < 1_000_000) {
    const th = Math.floor(n / 1000);
    const rest = n % 1000;
    const head = th === 1 ? "mil" : `${apocope(below1000(th))} mil`;
    return rest ? `${head} ${below1000(rest)}` : head;
  }
  const m = Math.floor(n / 1_000_000);
  const rest = n % 1_000_000;
  const head = m === 1 ? "un millón" : `${apocope(spellNumberEs(m))} millones`;
  return rest ? `${head} ${spellNumberEs(rest)}` : head;
}

const SPANISH = new Set(["es", "es-PY", "jopara"]);

export function isSpanish(language: string): boolean {
  return SPANISH.has(language);
}

/** Digits → words for Spanish ("1.500" and "1500" → "mil quinientos"; "3,5" → "tres coma cinco"). */
export function normalizeText(text: string, language: string): string {
  if (!isSpanish(language)) return text;
  return text.replace(/\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:,\d+)?/g, (match) => {
    const [whole, frac] = match.split(",");
    const words = spellNumberEs(Number(whole.replace(/\./g, "")));
    if (!frac) return words;
    return `${words} coma ${[...frac].map((d) => UNITS[Number(d)]).join(" ")}`;
  });
}
