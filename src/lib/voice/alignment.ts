import type { WordTiming } from "./contract";

/**
 * Word timings (docs/VOICE.md). ElevenLabs' `with-timestamps` endpoint gives
 * one start/end per *character* of the text it was sent; captions want words.
 * Pure.
 */

export type CharacterAlignment = {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
};

/** Group characters into words at whitespace; times in whole milliseconds. */
export function charactersToWords(alignment: CharacterAlignment | null | undefined): WordTiming[] {
  if (!alignment || !Array.isArray(alignment.characters)) return [];
  const {
    characters,
    character_start_times_seconds: starts,
    character_end_times_seconds: ends,
  } = alignment;
  const words: WordTiming[] = [];
  let word = "";
  let start = 0;
  let end = 0;
  const flush = () => {
    if (word)
      words.push({ word, startMs: Math.round(start * 1000), endMs: Math.round(end * 1000) });
    word = "";
  };
  for (let i = 0; i < characters.length; i++) {
    const ch = characters[i] ?? "";
    if (/^\s*$/u.test(ch)) {
      flush();
      continue;
    }
    if (!word) start = Number(starts[i] ?? end);
    word += ch;
    end = Number(ends[i] ?? starts[i] ?? end);
  }
  flush();
  return words;
}

/**
 * Timings come back for the text the provider was *sent* (after respelling).
 * When the respelled text has as many words as the original, the original
 * words are put back so captions show what was written; otherwise the spoken
 * words are kept (a respelling that split a word).
 */
export function restoreWords(timings: WordTiming[], originalText: string): WordTiming[] {
  const original = originalText.normalize("NFC").split(/\s+/u).filter(Boolean);
  if (original.length !== timings.length) return timings;
  return timings.map((t, i) => ({ ...t, word: original[i] }));
}

/** Evenly spread words over `durationMs`, by length (the test double; also a caption fallback). */
export function proportionalWords(text: string, durationMs: number): WordTiming[] {
  const words = text.normalize("NFC").split(/\s+/u).filter(Boolean);
  const total = words.reduce((n, w) => n + w.length + 1, 0);
  if (!total) return [];
  const timings: WordTiming[] = [];
  let at = 0;
  for (const word of words) {
    const span = ((word.length + 1) / total) * durationMs;
    timings.push({ word, startMs: Math.round(at), endMs: Math.round(at + span * 0.9) });
    at += span;
  }
  return timings;
}
