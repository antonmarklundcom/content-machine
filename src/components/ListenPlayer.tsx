"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useTranslator } from "@/lib/i18n/client";
import type { TranslationKey } from "@/lib/i18n";
import {
  clampRate,
  DEFAULT_RATE,
  formatRate,
  MAX_RATE,
  MIN_RATE,
  RATE_STEP,
} from "@/lib/listen/rate";
import type { ContentUnit, UnitType } from "@/lib/listen/units";
import { toggleUnitMark } from "@/lib/marks.actions";

const RATE_STORAGE_KEY = "yt_listen_rate";

/**
 * Chrome (desktop) silently stops a long utterance after roughly fifteen
 * seconds unless the queue is nudged. pause()+resume() on a timer is the
 * long-standing workaround; it is inaudible, and on engines that do not need
 * it, it is a no-op pair. See the handoff note for the browsers this was
 * observed on.
 */
const KEEPALIVE_MS = 10_000;

const TYPE_LABEL: Record<UnitType, TranslationKey> = {
  summary: "section.summary",
  takeaway: "listen.unit.takeaway",
  hook: "section.hook",
  timeline: "listen.unit.timeline",
  gap: "listen.unit.gap",
  idea: "listen.unit.idea",
};

const BUTTON =
  "surface-border rounded-[var(--radius-sm)] px-3 py-1.5 text-xs font-medium text-[var(--color-ink)] transition-colors hover:border-[var(--color-accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] disabled:opacity-40 disabled:hover:border-[var(--color-border-subtle)]";

/**
 * [PR-36] Listen mode — the stored analysis, read aloud by the browser.
 *
 * `SpeechSynthesisUtterance` only: no audio is generated, nothing is stored,
 * and no external service is involved, so listening to the whole corpus costs
 * exactly nothing (PLAN.md §6 — no new external service). A paid TTS API with
 * downloadable files is a deliberate future opt-in, not this.
 *
 * One unit is spoken per utterance rather than the whole analysis as one blob.
 * That is what makes "next section" and "previous section" mean anything, what
 * gives the position readout something to say, and what PR-37's marking points
 * at — the queue *is* the addressable unit list (lib/listen/units.ts).
 */
export function ListenPlayer({
  units,
  videoId,
  markedKeys,
}: {
  units: ContentUnit[];
  videoId: number;
  /** [PR-37] The units this user has already starred, as `${type}:${index}`. */
  markedKeys: string[];
}) {
  const t = useTranslator();
  // null until the effect runs: the server has no speechSynthesis, so deciding
  // this during render would produce two different trees and a hydration
  // mismatch on every video page.
  const [supported, setSupported] = useState<boolean | null>(null);
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  /**
   * Distinct from `!playing`. A paused session still holds a queue inside the
   * engine that resume() will pick up mid-sentence; a stopped one does not, and
   * pressing play there has to re-queue from the cursor. Deriving this from
   * `speechSynthesis.paused` instead would be reading a flag that several
   * engines set inconsistently after cancel().
   */
  const [paused, setPaused] = useState(false);
  const [rate, setRate] = useState(DEFAULT_RATE);
  /**
   * [PR-37] Marks, held locally so the star flips on the click rather than
   * after the round trip. The server action revalidates, which re-renders this
   * component with fresh props — the effect below re-syncs from them, so an
   * optimistic flip that the server rejected does not survive.
   */
  const [marked, setMarked] = useState<Set<string>>(() => new Set(markedKeys));
  const [marking, startMarking] = useTransition();

  /**
   * Bumped on every deliberate stop. An utterance's `onend` fires after
   * cancel() too, and without this token that late callback would advance the
   * cursor past the unit the user just skipped to.
   */
  const runRef = useRef(0);

  useEffect(() => {
    const ok = typeof window !== "undefined" && "speechSynthesis" in window;
    setSupported(ok);
    if (!ok) return;
    try {
      const stored = window.localStorage.getItem(RATE_STORAGE_KEY);
      if (stored !== null) setRate(clampRate(Number(stored)));
    } catch {
      // Private-mode Safari throws on localStorage. The default rate is fine.
    }
  }, []);

  // Keyed on the joined list rather than the array: props hand a new array
  // identity every render, and depending on that would re-run on every tick.
  const markedSignature = markedKeys.join(",");
  useEffect(() => {
    setMarked(new Set(markedSignature ? markedSignature.split(",") : []));
  }, [markedSignature]);

  const stop = useCallback(() => {
    runRef.current += 1;
    setPlaying(false);
    setPaused(false);
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
  }, []);

  // Leaving the page mid-sentence must not leave the engine talking: speech
  // synthesis is per-document but outlives a client-side navigation.
  useEffect(() => stop, [stop]);

  const speakFrom = useCallback(
    (start: number, currentRate: number) => {
      if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
      const synth = window.speechSynthesis;
      synth.cancel();
      runRef.current += 1;
      const run = runRef.current;

      if (start < 0 || start >= units.length) {
        setPlaying(false);
        return;
      }

      setCursor(start);
      setPlaying(true);
      setPaused(false);

      // Queued in one go rather than re-entered per unit: the engine keeps its
      // own queue, and re-arming from each `onend` leaves an audible gap at
      // every section boundary. The per-utterance handler is only bookkeeping.
      units.slice(start).forEach((unit, offset) => {
        const utterance = new SpeechSynthesisUtterance(unit.text);
        utterance.rate = currentRate;
        utterance.onstart = () => {
          if (run !== runRef.current) return;
          setCursor(start + offset);
        };
        utterance.onend = () => {
          if (run !== runRef.current) return;
          if (start + offset === units.length - 1) setPlaying(false);
        };
        utterance.onerror = () => {
          if (run !== runRef.current) return;
          setPlaying(false);
        };
        synth.speak(utterance);
      });
    },
    [units],
  );

  // The Chrome keepalive, armed only while actually playing.
  useEffect(() => {
    if (!playing || typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const synth = window.speechSynthesis;
    const timer = window.setInterval(() => {
      if (synth.speaking && !synth.paused) {
        synth.pause();
        synth.resume();
      }
    }, KEEPALIVE_MS);
    return () => window.clearInterval(timer);
  }, [playing]);

  function toggle() {
    if (!supported) return;
    const synth = window.speechSynthesis;
    if (playing) {
      // pause() rather than cancel(): resuming mid-sentence is the difference
      // between a pause button and a stop button. Where an engine refuses to
      // pause (some mobile builds), the resume branch below re-speaks the unit
      // from its start instead, which is the graceful version of the failure.
      synth.pause();
      setPlaying(false);
      setPaused(true);
      return;
    }
    if (paused && synth.speaking) {
      synth.resume();
      setPlaying(true);
      setPaused(false);
      return;
    }
    speakFrom(cursor, rate);
  }

  function step(delta: number) {
    const next = Math.min(units.length - 1, Math.max(0, cursor + delta));
    if (playing || paused) {
      // Skipping while paused resumes at the new section rather than staying
      // frozen on it — the button was pressed to hear something else.
      speakFrom(next, rate);
    } else {
      // Not playing: move the marker without starting to talk. Skipping through
      // an analysis to find a section should not commit you to hearing it.
      stop();
      setCursor(next);
    }
  }

  function changeRate(next: number) {
    const value = clampRate(next);
    setRate(value);
    try {
      window.localStorage.setItem(RATE_STORAGE_KEY, String(value));
    } catch {
      // See above — a rate that does not persist is not worth an error.
    }
    // `rate` is read when an utterance is queued and ignored after; the only
    // way to apply a new speed is to re-queue from the current unit.
    if (playing || paused) speakFrom(cursor, value);
  }

  /**
   * "Mark the last thing I heard" — one click, no aiming.
   *
   * The unit being read *is* the cursor, which is the whole reason PR-36 tracks
   * a content unit instead of an audio position: there is nothing to scrub back
   * to and nothing to guess at. Playback is not interrupted; marking a passage
   * you are still hearing should not stop you hearing it.
   */
  function toggleCurrentMark(unit: ContentUnit) {
    const isMarked = marked.has(unit.key);
    setMarked((prev) => {
      const next = new Set(prev);
      if (isMarked) next.delete(unit.key);
      else next.add(unit.key);
      return next;
    });
    startMarking(async () => {
      await toggleUnitMark(
        { videoId, unitType: unit.type, unitIndex: unit.index, unitText: unit.text },
        isMarked,
      );
    });
  }

  if (units.length === 0) return null;

  // Clamped rather than indexed raw: the cursor is state and `units` is a prop,
  // so a re-render with a shorter analysis can arrive with the cursor past its end.
  const current = units[Math.min(cursor, units.length - 1)] ?? units[0];
  if (!current) return null;
  const total = units.filter((u) => u.type === current.type).length;
  const label = `${t(TYPE_LABEL[current.type])}${total > 1 ? ` ${current.index + 1}` : ""}`;

  return (
    <section
      aria-label={t("listen.title")}
      className="surface-border surface-card flex flex-col gap-3 px-5 py-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xs font-medium tracking-widest text-[var(--color-accent)] uppercase">
          {t("listen.title")}
        </h2>
        <p className="text-xs text-[var(--color-ink-muted)]" aria-live="polite">
          {label} · {t("listen.position", { position: cursor + 1, total: units.length })}
        </p>
      </div>

      {supported === false ? (
        <p className="text-sm text-[var(--color-ink-muted)]">{t("listen.unsupported")}</p>
      ) : (
        <>
          <p className="text-sm leading-relaxed text-[var(--color-ink)]">{current.text}</p>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={BUTTON}
              onClick={() => step(-1)}
              disabled={!supported || cursor === 0}
            >
              {t("listen.previous")}
            </button>
            <button
              type="button"
              className="rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-4 py-1.5 text-xs font-medium text-[var(--color-accent-ink)] transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] disabled:opacity-40"
              onClick={toggle}
              disabled={!supported}
            >
              {t(playing ? "listen.pause" : "listen.play")}
            </button>
            <button
              type="button"
              className={BUTTON}
              onClick={() => step(1)}
              disabled={!supported || cursor === units.length - 1}
            >
              {t("listen.next")}
            </button>
            <button
              type="button"
              className={BUTTON}
              onClick={() => {
                stop();
                setCursor(0);
              }}
              disabled={!supported}
            >
              {t("listen.restart")}
            </button>

            <button
              type="button"
              className={`${BUTTON} ${
                marked.has(current.key) ? "border-[var(--color-warn)] text-[var(--color-warn)]" : ""
              }`}
              onClick={() => toggleCurrentMark(current)}
              disabled={marking}
              aria-pressed={marked.has(current.key)}
            >
              {marked.has(current.key) ? "★" : "☆"}{" "}
              {t(marked.has(current.key) ? "listen.marked" : "listen.markHeard")}
            </button>

            <label
              htmlFor="listen-rate"
              className="ml-auto flex items-center gap-2 text-xs text-[var(--color-ink-muted)]"
            >
              {t("listen.speed")}
              <input
                id="listen-rate"
                type="range"
                min={MIN_RATE}
                max={MAX_RATE}
                step={RATE_STEP}
                value={rate}
                disabled={!supported}
                onChange={(event) => changeRate(Number(event.target.value))}
                className="w-28 accent-[var(--color-accent)] focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:outline-none"
              />
              <span className="w-10 font-mono text-[var(--color-ink)]">{formatRate(rate)}</span>
            </label>
          </div>
        </>
      )}
    </section>
  );
}
