"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TeleprompterBlock } from "@/app/studio/model";
import { useTranslator } from "@/lib/i18n/client";

const MIN_SPEED = 10;
const MAX_SPEED = 300;
const MIN_FONT = 28;
const MAX_FONT = 140;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

const CONTROL =
  "rounded border border-white/30 px-3 py-1 text-sm text-white/90 hover:border-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white";

/**
 * The teleprompter (PLAN.md §6.S12.2): spoken lines only, big type, white on
 * black, auto-scroll. Space pauses, ↑/↓ change speed, +/− change size, F goes
 * full screen, Home goes back to the top. No library: one requestAnimationFrame
 * loop moving `scrollTop`, so a manual scroll (wheel, drag) is simply where the
 * next frame continues from.
 */
export function StudioTeleprompter({
  title,
  blocks,
  backHref,
}: {
  title: string;
  blocks: TeleprompterBlock[];
  backHref: string;
}) {
  const t = useTranslator();
  const root = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(40); // px per second
  const [fontSize, setFontSize] = useState(56); // px

  // Where the scroll really is, in fractional pixels: scrollTop rounds, and at
  // slow speeds a rounded position would never move.
  const position = useRef(0);

  useEffect(() => {
    if (!playing) return;
    const el = scroller.current;
    if (!el) return;
    position.current = el.scrollTop;
    let last = performance.now();
    let frame = requestAnimationFrame(function step(now) {
      const dt = (now - last) / 1000;
      last = now;
      // Follow a manual scroll instead of fighting it.
      if (Math.abs(el.scrollTop - position.current) > 2) position.current = el.scrollTop;
      position.current += speed * dt;
      el.scrollTop = position.current;
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 1) {
        setPlaying(false);
        return;
      }
      frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [playing, speed]);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void root.current?.requestFullscreen?.();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLElement && e.target.closest("input, textarea, select")) return;
      if (e.code === "Space") {
        e.preventDefault(); // not "page down"
        // A focused control (Play after a mouse click) would also be activated
        // by Space on keyup and toggle straight back; blurring it now means the
        // keyup lands on the page instead.
        if (e.target instanceof HTMLElement && e.target.closest("button, a")) e.target.blur();
        setPlaying((p) => !p);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSpeed((s) => clamp(s + 10, MIN_SPEED, MAX_SPEED));
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSpeed((s) => clamp(s - 10, MIN_SPEED, MAX_SPEED));
      } else if (e.key === "+" || e.key === "=") {
        setFontSize((f) => clamp(f + 4, MIN_FONT, MAX_FONT));
      } else if (e.key === "-" || e.key === "_") {
        setFontSize((f) => clamp(f - 4, MIN_FONT, MAX_FONT));
      } else if (e.key === "f" || e.key === "F") {
        toggleFullscreen();
      } else if (e.key === "Home") {
        e.preventDefault();
        if (scroller.current) scroller.current.scrollTop = 0;
        position.current = 0;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleFullscreen]);

  return (
    <div
      ref={root}
      className="fixed inset-0 z-50 flex flex-col bg-black text-white"
      data-teleprompter
    >
      <div className="flex flex-wrap items-center gap-3 border-b border-white/15 px-4 py-2 text-sm">
        <a href={backHref} className={CONTROL}>
          ← {t("studio.teleprompter.exit")}
        </a>
        <button type="button" className={CONTROL} onClick={() => setPlaying((p) => !p)}>
          {playing ? t("studio.teleprompter.pause") : t("studio.teleprompter.play")}
        </button>
        <label className="flex items-center gap-2 text-white/80">
          {t("studio.teleprompter.speed")}
          <input
            type="range"
            min={MIN_SPEED}
            max={MAX_SPEED}
            step={5}
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
          />
        </label>
        <label className="flex items-center gap-2 text-white/80">
          {t("studio.teleprompter.size")}
          <input
            type="range"
            min={MIN_FONT}
            max={MAX_FONT}
            step={2}
            value={fontSize}
            onChange={(e) => setFontSize(Number(e.target.value))}
          />
        </label>
        <button type="button" className={CONTROL} onClick={toggleFullscreen}>
          {t("studio.teleprompter.fullscreen")}
        </button>
        <span className="ml-auto hidden text-xs text-white/50 md:inline">
          {t("studio.teleprompter.keys")}
        </span>
      </div>

      <div className="relative flex-1 overflow-hidden">
        {/* The reading line: the eye stays here while the text moves past it. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-[33%] z-10 border-t border-white/20"
        />
        <div ref={scroller} className="h-full overflow-y-auto" style={{ scrollbarWidth: "none" }}>
          <div
            className="mx-auto max-w-5xl px-8 pt-[33vh] pb-[80vh] font-semibold"
            style={{ fontSize: `${fontSize}px`, lineHeight: 1.35 }}
          >
            <p className="mb-[1em] text-[0.4em] font-normal text-white/50">{title}</p>
            {blocks.map((block, i) => (
              <section key={i} className="mb-[1.2em]">
                <p className="mb-[0.4em] text-[0.35em] font-medium tracking-widest text-white/40 uppercase">
                  {block.kind === "hook"
                    ? t("studio.editor.hook")
                    : block.kind === "cta"
                      ? t("studio.editor.cta")
                      : block.heading}
                  {block.verify.length > 0 && (
                    <span className="ml-3 text-amber-400" data-verify-badge>
                      ⚠ {t("studio.verifyBadge")} · {block.verify.join(", ")}
                    </span>
                  )}
                </p>
                {block.lines.map((line, j) => (
                  <p key={j} className="mb-[0.5em]">
                    {line}
                  </p>
                ))}
              </section>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
