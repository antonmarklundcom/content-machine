import type { WordTiming } from "@/lib/voice/contract";

import type { RenderScene } from "./contract";
import type { Timeline } from "./timeline";

/**
 * Caption cues (PLAN-build4 §1.9). Pure. From the provider's word timings
 * when there are any, else proportional timing by character count across the
 * scene's narration, split at sentence boundaries. Cues are ≤ 2 lines of ≤ 42
 * characters, ≤ 6 s, at least 0.8 s, and never cross into the next scene.
 */

export const MAX_LINE_CHARS = 42;
export const MAX_LINES = 2;
export const MAX_CUE_MS = 6000;
export const MIN_CUE_MS = 800;

export type Cue = { startMs: number; endMs: number; lines: string[]; sceneRef: string };

const SENTENCE_END = /[.!?…]["»”’)\]]*$/;

function words(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

/**
 * The text as ≤ `maxLines` lines of ≤ `maxChars`, balanced when it takes two;
 * null when it does not fit. A single word longer than a line is allowed alone.
 */
export function wrapLines(
  text: string,
  maxChars = MAX_LINE_CHARS,
  maxLines = MAX_LINES,
): string[] | null {
  const ws = words(text);
  if (!ws.length) return [];
  const joined = ws.join(" ");
  if (joined.length <= maxChars || ws.length === 1) return [joined];
  if (maxLines < 2) return null;
  // Two lines: the split point that makes the longer line shortest.
  let best: string[] | null = null;
  let bestLen = Infinity;
  for (let i = 1; i < ws.length; i++) {
    const a = ws.slice(0, i).join(" ");
    const b = ws.slice(i).join(" ");
    const fitsA = a.length <= maxChars || i === 1;
    const fitsB = b.length <= maxChars || i === ws.length - 1;
    if (!fitsA || !fitsB) continue;
    const longest = Math.max(a.length, b.length);
    if (longest < bestLen) {
      best = [a, b];
      bestLen = longest;
    }
  }
  return best;
}

function fits(text: string): boolean {
  return wrapLines(text) !== null;
}

/** Sentences, keeping their punctuation. */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  let current: string[] = [];
  for (const w of words(text)) {
    current.push(w);
    if (SENTENCE_END.test(w)) {
      out.push(current.join(" "));
      current = [];
    }
  }
  if (current.length) out.push(current.join(" "));
  return out;
}

/** Word groups that each fit a cue, as even as possible. */
export function chunkWords(ws: string[]): string[][] {
  const chunks: string[][] = [];
  let current: string[] = [];
  for (const w of ws) {
    const next = [...current, w];
    if (current.length && !fits(next.join(" "))) {
      chunks.push(current);
      current = [w];
    } else {
      current = next;
    }
  }
  if (current.length) chunks.push(current);
  return chunks;
}

type TimedWord = { word: string; startMs: number; endMs: number };

/**
 * The caption text's own words (with punctuation) take the provider's times
 * when the counts match; otherwise the provider's words are shown as given.
 */
function timedWords(captionText: string, alignment: WordTiming[]): TimedWord[] {
  const ws = words(captionText);
  const clean = alignment.filter((a) => a.word.trim() && Number.isFinite(a.startMs));
  if (ws.length === clean.length) {
    return clean.map((a, i) => ({ word: ws[i], startMs: a.startMs, endMs: a.endMs }));
  }
  return clean.map((a) => ({ word: a.word.trim(), startMs: a.startMs, endMs: a.endMs }));
}

/** Cues for one scene from word timings, times relative to the scene's audio. */
export function cuesFromTimings(
  captionText: string,
  alignment: WordTiming[],
): Omit<Cue, "sceneRef">[] {
  const tws = timedWords(captionText, alignment);
  const cues: Omit<Cue, "sceneRef">[] = [];
  let group: TimedWord[] = [];
  const flush = () => {
    if (!group.length) return;
    const text = group.map((g) => g.word).join(" ");
    cues.push({
      startMs: group[0].startMs,
      endMs: Math.max(group[group.length - 1].endMs, group[0].startMs),
      lines: wrapLines(text) ?? [text],
    });
    group = [];
  };
  for (const tw of tws) {
    if (group.length) {
      const text = [...group, tw].map((g) => g.word).join(" ");
      const tooLong = tw.endMs - group[0].startMs > MAX_CUE_MS;
      if (!fits(text) || tooLong) flush();
    }
    group.push(tw);
    if (SENTENCE_END.test(tw.word)) flush();
  }
  flush();
  return cues;
}

/** Cues for one scene by character share across `spanMs`, split at sentences. */
export function cuesProportional(captionText: string, spanMs: number): Omit<Cue, "sceneRef">[] {
  const sentences = splitSentences(captionText);
  const chunks = sentences.flatMap((s) => {
    const parts = chunkWords(words(s));
    // A sentence longer than 6 s of its share is split further below by time.
    return parts.map((p) => p.join(" "));
  });
  const totalChars = chunks.reduce((sum, c) => sum + c.length, 0);
  if (!totalChars || spanMs <= 0) return [];
  const cues: Omit<Cue, "sceneRef">[] = [];
  let cursor = 0;
  let charsSoFar = 0;
  for (const chunk of chunks) {
    charsSoFar += chunk.length;
    const end = Math.round((spanMs * charsSoFar) / totalChars);
    pushWithinMax(cues, chunk, cursor, end);
    cursor = end;
  }
  return cues;
}

/** A chunk whose share runs past 6 s is cut into word groups that each stay under it. */
function pushWithinMax(
  cues: Omit<Cue, "sceneRef">[],
  text: string,
  startMs: number,
  endMs: number,
): void {
  const span = endMs - startMs;
  const pieces = Math.ceil(span / MAX_CUE_MS);
  const ws = words(text);
  if (pieces <= 1 || ws.length < 2) {
    cues.push({ startMs, endMs, lines: wrapLines(text) ?? [text] });
    return;
  }
  // More pieces until each one's character share of the time is under 6 s.
  let planned: Omit<Cue, "sceneRef">[] = [];
  for (let n = Math.min(pieces, ws.length); n <= ws.length; n++) {
    const per = ws.length / n;
    const texts: string[] = [];
    for (let i = 0; i < n; i++) {
      const part = ws.slice(Math.round(i * per), Math.round((i + 1) * per));
      if (part.length) texts.push(part.join(" "));
    }
    const total = texts.reduce((sum, t) => sum + t.length, 0);
    let chars = 0;
    let cursor = startMs;
    planned = texts.map((t) => {
      chars += t.length;
      const end = Math.round(startMs + (span * chars) / total);
      const cue = { startMs: cursor, endMs: end, lines: wrapLines(t) ?? [t] };
      cursor = end;
      return cue;
    });
    if (planned.every((c) => c.endMs - c.startMs <= MAX_CUE_MS)) break;
  }
  // A single word that still runs long is shown for 6 s, then the screen clears.
  for (const cue of planned) cue.endMs = Math.min(cue.endMs, cue.startMs + MAX_CUE_MS);
  cues.push(...planned);
}

/**
 * Every cue of the video: per scene, offset by the scene's start, clamped to
 * the scene, stretched to the 0.8 s minimum where the next cue leaves room.
 */
export function planCues(scenes: RenderScene[], timeline: Timeline): Cue[] {
  const all: Cue[] = [];
  scenes.forEach((scene, i) => {
    const slot = timeline.scenes[i];
    if (!slot) return;
    const text = scene.captionText?.trim() ?? "";
    if (!text) return;
    const local =
      scene.alignment && scene.alignment.length
        ? cuesFromTimings(text, scene.alignment)
        : cuesProportional(text, slot.audioMs > 0 ? slot.audioMs : slot.durationMs);
    for (const cue of local) {
      const startMs = Math.min(slot.endMs, Math.max(slot.startMs, slot.startMs + cue.startMs));
      const endMs = Math.min(slot.endMs, slot.startMs + cue.endMs);
      all.push({
        startMs,
        endMs: Math.max(endMs, startMs),
        lines: cue.lines,
        sceneRef: scene.sceneRef,
      });
    }
  });

  // No overlaps, and the minimum length where there is room for it.
  for (let i = 0; i < all.length; i++) {
    const cue = all[i];
    const prev = all[i - 1];
    if (prev && cue.startMs < prev.endMs) cue.startMs = prev.endMs;
    const next = all[i + 1];
    const limit = Math.min(next ? next.startMs : Infinity, timeline.totalMs);
    if (cue.endMs - cue.startMs < MIN_CUE_MS) {
      cue.endMs = Math.max(cue.endMs, Math.min(cue.startMs + MIN_CUE_MS, limit));
    }
    if (cue.endMs < cue.startMs) cue.endMs = cue.startMs;
  }
  return all.filter((c) => c.endMs > c.startMs && c.lines.length);
}

// ---------------------------------------------------------------------------
// writers
// ---------------------------------------------------------------------------

function stamp(ms: number, sep: "," | "."): string {
  const total = Math.max(0, Math.round(ms));
  const h = Math.floor(total / 3_600_000);
  const m = Math.floor((total % 3_600_000) / 60_000);
  const s = Math.floor((total % 60_000) / 1000);
  const milli = total % 1000;
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(h)}:${p(m)}:${p(s)}${sep}${p(milli, 3)}`;
}

export const srtTimestamp = (ms: number) => stamp(ms, ",");
export const vttTimestamp = (ms: number) => stamp(ms, ".");

/**
 * SRT has no escape syntax, so text that players or libass would read as
 * markup is neutralised: no blank lines (they end a cue), no `-->`, and no
 * `<tags>` or `{\overrides}`.
 */
export function escapeSrt(line: string): string {
  return line
    .replace(/\r?\n/g, " ")
    .replace(/-->/g, "→")
    .replace(/</g, "‹")
    .replace(/>/g, "›")
    .replace(/\{/g, "(")
    .replace(/\}/g, ")")
    .trim();
}

/** WebVTT cue text: `&`, `<` and `>` as entities (which also covers `-->`). */
export function escapeVtt(line: string): string {
  return line
    .replace(/\r?\n/g, " ")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .trim();
}

export function toSrt(cues: Cue[]): string {
  return cues
    .map(
      (c, i) =>
        `${i + 1}\n${srtTimestamp(c.startMs)} --> ${srtTimestamp(c.endMs)}\n${c.lines.map(escapeSrt).join("\n")}\n`,
    )
    .join("\n");
}

export function toVtt(cues: Cue[]): string {
  const body = cues
    .map(
      (c, i) =>
        `${i + 1}\n${vttTimestamp(c.startMs)} --> ${vttTimestamp(c.endMs)}\n${c.lines.map(escapeVtt).join("\n")}\n`,
    )
    .join("\n");
  return `WEBVTT\n\n${body}`;
}
