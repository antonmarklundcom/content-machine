"use client";

import { meterFraction, toDb } from "@/lib/voice/record/analyze";

/**
 * The live input meter (−60…0 dBFS): RMS as the bar, peak as a tick, red when
 * the peak touches the top. Aim for speech peaks around −12…−6 dBFS.
 */
export function RecorderMeter({
  peak,
  rms,
  clipped,
  label,
}: {
  peak: number;
  rms: number;
  clipped: boolean;
  label: string;
}) {
  const bar = meterFraction(rms) * 100;
  const tick = meterFraction(peak) * 100;
  const db = toDb(peak);
  return (
    <div className="flex items-center gap-3" aria-label={label}>
      <div className="relative h-3 flex-1 overflow-hidden rounded-full bg-[var(--color-surface-raised)]">
        {/* Target zone −18…−6 dBFS */}
        <div
          className="absolute inset-y-0 bg-[var(--color-accent)] opacity-10"
          style={{ left: `${(42 / 60) * 100}%`, width: `${(12 / 60) * 100}%` }}
        />
        <div
          className={`absolute inset-y-0 left-0 transition-[width] duration-75 ${
            clipped ? "bg-[var(--color-danger)]" : "bg-[var(--color-accent)]"
          }`}
          style={{ width: `${bar}%` }}
        />
        <div
          className={`absolute inset-y-0 w-0.5 ${
            clipped ? "bg-[var(--color-danger)]" : "bg-[var(--color-ink)]"
          }`}
          style={{ left: `calc(${tick}% - 1px)` }}
        />
      </div>
      <span
        className={`w-16 text-right font-mono text-xs ${
          clipped ? "text-[var(--color-danger)]" : "text-[var(--color-ink-muted)]"
        }`}
      >
        {Number.isFinite(db) ? `${db.toFixed(0)} dB` : "–∞ dB"}
      </span>
    </div>
  );
}
