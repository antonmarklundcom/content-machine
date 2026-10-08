/**
 * Which lines a speaker has already recorded, and where a session resumes
 * (build 5 §3.B). Pure: fed with `narrations` rows by `session.ts`.
 *
 * A line counts as recorded by a profile when there is a finished `manual`
 * take on its slot, by that profile, in the session's voice language, whose
 * input text is the line's current text verbatim (as in the stories studio: a
 * take of an older text does not count). Rejected takes do not count either.
 */
import type { RecordLine } from "./lines";

/** The parts of a `narrations` row the session looks at. */
export type RecordTakeLike = {
  id: number;
  ownerKind: string;
  ownerRef: string;
  sceneRef: string | null;
  language: string;
  voiceProfileId: number | null;
  speaker: string | null;
  provider: string;
  status: string;
  inputText: string;
  reviewStatus: string;
  selected: boolean;
  durationMs: number | null;
};

export type LineState = RecordLine & {
  /** Recorded takes by this profile on the line (manual, done, current text, not rejected). */
  takeCount: number;
  /** Their total length. */
  recordedMs: number;
  /** The slot already has a selected take (anyone's) that says the current text. */
  hasSelected: boolean;
};

export type SessionProgress = {
  /** Lines that may be recorded (not locked). */
  total: number;
  recorded: number;
  locked: number;
  /** Length of the kept takes counted above (the newest per line). */
  recordedMs: number;
  /** Index of the first unlocked line without a take by this profile; null when all are done. */
  resumeIndex: number | null;
};

function sameLine(line: RecordLine, take: RecordTakeLike, voiceLang: string): boolean {
  return (
    take.ownerKind === line.ownerKind &&
    take.ownerRef === line.ownerRef &&
    take.sceneRef === line.slot &&
    take.language === voiceLang &&
    (take.speaker ?? null) === (line.speaker ?? null) &&
    take.inputText === line.text
  );
}

/** Is `take` a usable recording of `line` by `profileId`? */
export function countsAsRecorded(
  line: RecordLine,
  take: RecordTakeLike,
  profileId: number,
  voiceLang: string,
): boolean {
  return (
    sameLine(line, take, voiceLang) &&
    take.voiceProfileId === profileId &&
    take.provider === "manual" &&
    take.status === "done" &&
    take.reviewStatus !== "rejected"
  );
}

/** Each line with what this profile has recorded on it. */
export function lineStates(
  lines: RecordLine[],
  takes: RecordTakeLike[],
  profileId: number,
  voiceLang: string,
): LineState[] {
  return lines.map((line) => {
    if (line.locked) return { ...line, takeCount: 0, recordedMs: 0, hasSelected: false };
    const mine = takes.filter((t) => countsAsRecorded(line, t, profileId, voiceLang));
    const hasSelected = takes.some(
      (t) => sameLine(line, t, voiceLang) && t.selected && t.status === "done",
    );
    // The newest kept take is the one that counts towards minutes recorded.
    const newest = mine.reduce<RecordTakeLike | null>((a, t) => (!a || t.id > a.id ? t : a), null);
    return {
      ...line,
      takeCount: mine.length,
      recordedMs: newest?.durationMs ?? 0,
      hasSelected,
    };
  });
}

/** The first unlocked line at or after `from` that has no take yet; wraps around once. */
export function nextUnrecorded(states: LineState[], from = 0): number | null {
  const n = states.length;
  for (let k = 0; k < n; k++) {
    const i = (from + k) % n;
    if (!states[i].locked && states[i].takeCount === 0) return i;
  }
  return null;
}

export function sessionProgress(states: LineState[]): SessionProgress {
  let total = 0;
  let recorded = 0;
  let recordedMs = 0;
  for (const s of states) {
    if (s.locked) continue;
    total++;
    if (s.takeCount > 0) {
      recorded++;
      recordedMs += s.recordedMs;
    }
  }
  return {
    total,
    recorded,
    locked: states.length - total,
    recordedMs,
    resumeIndex: nextUnrecorded(states, 0),
  };
}

/** The next/previous unlocked line from `index` (`dir` = +1 / -1); stays put at either end. */
export function stepLine(states: { locked: unknown }[], index: number, dir: 1 | -1): number {
  for (let i = index + dir; i >= 0 && i < states.length; i += dir) {
    if (!states[i].locked) return i;
  }
  return index;
}
