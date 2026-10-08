"use client";

import { useState } from "react";
import type { Analysis } from "@/db/schema";
import { useTranslator } from "@/lib/i18n/client";

function toPlainText(video: { title: string }, analysis: Analysis): string {
  const lines: string[] = [video.title, ""];

  if (analysis.summary) lines.push("SUMMARY", analysis.summary, "");

  if (analysis.takeaways?.length) {
    lines.push("TAKEAWAYS", ...analysis.takeaways.map((t) => `- ${t}`), "");
  }

  if (analysis.hookBreakdown) {
    const h = analysis.hookBreakdown;
    lines.push(
      "HOOK",
      `Technique: ${h.technique}`,
      `First 30s: ${h.first_30s}`,
      `Why it works: ${h.why_it_works}`,
      "",
    );
  }

  if (analysis.timeline?.length) {
    lines.push("TIMELINE", ...analysis.timeline.map((e) => `${e.ts}  ${e.topic} — ${e.beat}`), "");
  }

  if (analysis.gaps?.length) {
    lines.push("GAPS", ...analysis.gaps.map((g) => `- ${g.gap} → ${g.counter_angle}`), "");
  }

  if (analysis.ideas?.length) {
    lines.push(
      "IDEAS",
      ...analysis.ideas.map((i) => `- ${i.title}: ${i.premise} (why now: ${i.why_now})`),
      "",
    );
  }

  return lines.join("\n");
}

export function CopyAnalysisButton({
  video,
  analysis,
}: {
  video: { title: string };
  analysis: Analysis;
}) {
  const t = useTranslator();
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(toPlainText(video, analysis));
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }}
      className="surface-border rounded-[var(--radius-sm)] bg-[var(--color-surface-raised)] px-4 py-2 text-sm font-medium text-[var(--color-ink)] transition-colors hover:border-[var(--color-accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
    >
      {copied ? t("video.copied") : t("video.copyAnalysis")}
    </button>
  );
}
