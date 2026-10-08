import type { ScriptBodyV1 } from "@/lib/scripts/contract";

/**
 * The filming plan (build 2b, idea 5): tick the `ready` scripts, get one page
 * that says what to film in which order and how long the day will take.
 * Deterministic — no AI, nothing spent — so it is pure and unit-tested.
 */

/** Spoken words per minute used for every estimate here and in the publish pack. */
export const PLAN_WORDS_PER_MINUTE = 150;
/** Retakes, resets and flubs: the day takes half as long again as the words. */
export const RETAKE_FACTOR = 1.5;

/**
 * Words in talking points that say where a script is filmed or what has to be
 * on set. Scripts that share one are filmed back to back, so the set is built
 * once. Locations come first: moving is the expensive part of a day, a prop is
 * picked up. Lower-case, matched as whole words; English and Spanish, since
 * scripts are written in both.
 */
export const LOCATION_WORDS = [
  "outdoors",
  "outside",
  "street",
  "park",
  "car",
  "kitchen",
  "office",
  "bank",
  "notary",
  "escribanía",
  "migraciones",
  "airport",
  "aeropuerto",
  "calle",
  "afuera",
  "oficina",
  "cocina",
  "auto",
  "coche",
  "desk",
  "escritorio",
  "studio",
  "estudio",
  "whiteboard",
  "pizarra",
] as const;

export const PROP_WORDS = [
  "passport",
  "pasaporte",
  "documents",
  "documentos",
  "folder",
  "carpeta",
  "laptop",
  "notebook",
  "phone",
  "celular",
  "map",
  "mapa",
  "cash",
  "efectivo",
  "receipt",
  "recibo",
  "keys",
  "llaves",
  "calendar",
  "calendario",
  "mate",
  "tereré",
] as const;

export type PlanScript = { id: number; title: string; body: ScriptBodyV1 };

export type PlanItem = {
  id: number;
  title: string;
  /** The setup word it is grouped under, or null when its talking points name none. */
  group: string | null;
  /** Every location/prop word found, locations first. */
  setup: string[];
  words: number;
  spokenMinutes: number;
  withRetakesMinutes: number;
};

export type OnScreenItem = { scriptId: number; scriptTitle: string; part: string; text: string };

export type BrollItem = {
  scriptId: number;
  scriptTitle: string;
  part: string;
  description: string;
  spokenLine: string;
  aspectRatio: string;
  still: boolean;
};

export type FilmingPlan = {
  items: PlanItem[];
  totalWords: number;
  totalSpokenMinutes: number;
  totalWithRetakesMinutes: number;
  onScreen: OnScreenItem[];
  broll: BrollItem[];
};

/** Whitespace-separated words, the way a teleprompter reader counts them. */
export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

function linesWords(lines: string[]): number {
  return lines.reduce((sum, line) => sum + countWords(line), 0);
}

/** Every word Anton says: hook, sections, call to action. */
export function spokenWords(body: ScriptBodyV1): number {
  return (
    linesWords(body.hook.spokenLines) +
    body.sections.reduce((sum, s) => sum + linesWords(s.spokenLines), 0) +
    linesWords(body.cta.spokenLines)
  );
}

export function wordsToMinutes(words: number, wpm: number = PLAN_WORDS_PER_MINUTE): number {
  return words / wpm;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Letters in any script (so "escribanía" is one word), not just ASCII \w. */
function wholeWord(word: string): RegExp {
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(word)}($|[^\\p{L}\\p{N}])`, "iu");
}

/** The location and prop words in a script's talking points, locations first, in list order. */
export function setupWords(body: ScriptBodyV1): string[] {
  const notes = body.sections.flatMap((s) => s.talkingPoints).join("\n");
  if (!notes.trim()) return [];
  return [...LOCATION_WORDS, ...PROP_WORDS].filter((w) => wholeWord(w).test(notes));
}

/**
 * Filming order: scripts that share a setup are grouped (a location beats a
 * prop — see LOCATION_WORDS), bigger groups first so the longest stretch
 * without a reset comes early, scripts with no setup noted last. Inside a
 * group the longest script goes first, while energy is highest. Ties fall back
 * to title, then id, so the same ticks always print the same page.
 */
export function buildFilmingPlan(scripts: PlanScript[]): FilmingPlan {
  const measured = scripts.map((s) => {
    const words = spokenWords(s.body);
    const setup = setupWords(s.body);
    return { ...s, words, setup };
  });

  // Group key: the first setup word, but prefer one another selected script
  // shares — two scripts with "desk, passport" and "passport" belong together
  // under "passport" only if nothing better joins them.
  const counts = new Map<string, number>();
  for (const s of measured) for (const w of s.setup) counts.set(w, (counts.get(w) ?? 0) + 1);
  const keyed = measured.map((s) => {
    const shared = s.setup.filter((w) => (counts.get(w) ?? 0) > 1);
    return { ...s, group: shared[0] ?? s.setup[0] ?? null };
  });

  const groupSize = new Map<string | null, number>();
  for (const s of keyed) groupSize.set(s.group, (groupSize.get(s.group) ?? 0) + 1);

  keyed.sort((a, b) => {
    if ((a.group === null) !== (b.group === null)) return a.group === null ? 1 : -1;
    const size = (groupSize.get(b.group) ?? 0) - (groupSize.get(a.group) ?? 0);
    if (size) return size;
    if (a.group !== b.group) return (a.group ?? "").localeCompare(b.group ?? "");
    if (a.words !== b.words) return b.words - a.words;
    return a.title.localeCompare(b.title) || a.id - b.id;
  });

  const items: PlanItem[] = keyed.map((s) => {
    const spokenMinutes = wordsToMinutes(s.words);
    return {
      id: s.id,
      title: s.title,
      group: s.group,
      setup: s.setup,
      words: s.words,
      spokenMinutes,
      withRetakesMinutes: spokenMinutes * RETAKE_FACTOR,
    };
  });

  const byId = new Map(keyed.map((s) => [s.id, s]));
  const onScreen: OnScreenItem[] = [];
  const broll: BrollItem[] = [];
  for (const item of items) {
    const { body } = byId.get(item.id)!;
    const parts: { part: string; onScreenText: string[]; shots: ScriptBodyV1["hook"]["broll"] }[] =
      [
        { part: "Hook", onScreenText: body.hook.onScreenText, shots: body.hook.broll },
        ...body.sections.map((s) => ({
          part: s.heading,
          onScreenText: s.onScreenText,
          shots: s.broll,
        })),
        { part: "CTA", onScreenText: body.cta.onScreenText, shots: [] },
      ];
    for (const p of parts) {
      for (const text of p.onScreenText) {
        if (text.trim())
          onScreen.push({
            scriptId: item.id,
            scriptTitle: item.title,
            part: p.part,
            text: text.trim(),
          });
      }
      for (const shot of p.shots) {
        broll.push({
          scriptId: item.id,
          scriptTitle: item.title,
          part: p.part,
          description: shot.description,
          spokenLine: shot.spokenLine,
          aspectRatio: shot.aspectRatio,
          still: shot.videoPrompt === null,
        });
      }
    }
  }

  const totalWords = items.reduce((sum, i) => sum + i.words, 0);
  const totalSpokenMinutes = wordsToMinutes(totalWords);
  return {
    items,
    totalWords,
    totalSpokenMinutes,
    totalWithRetakesMinutes: totalSpokenMinutes * RETAKE_FACTOR,
    onScreen,
    broll,
  };
}

/** "1 h 05 min", "12 min", "0.5 min" — minutes rounded up to whole ones above one. */
export function formatMinutes(minutes: number): string {
  if (minutes < 1) return `${Math.round(minutes * 10) / 10} min`;
  const whole = Math.ceil(minutes);
  if (whole < 60) return `${whole} min`;
  return `${Math.floor(whole / 60)} h ${String(whole % 60).padStart(2, "0")} min`;
}
