/**
 * What the quick-capture form says after a confirmed save. Pure and
 * client-safe: it reads only the API's own receipt (`created` plus the stored
 * clip) and never guesses. A re-shared link is never a second row and never
 * changes purpose silently, so say that plainly instead of a bare "Saved."
 */
export type CaptureReceipt =
  | { key: "inbox.quickAdd.saved" }
  | { key: "capture.duplicate.unchanged" | "capture.duplicate.note" }
  | {
      key: "capture.duplicate.otherPurpose" | "capture.duplicate.otherPurposeNote";
      purpose: string;
    };

export function captureReceipt(
  data: Record<string, unknown>,
  requested: { note?: string; purpose?: string },
): CaptureReceipt {
  if (data.created !== false) return { key: "inbox.quickAdd.saved" };
  const clip = (data.clip ?? {}) as { purpose?: unknown };
  const stored = typeof clip.purpose === "string" ? clip.purpose : null;
  const wanted = requested.purpose ?? "other";
  const withNote = Boolean(requested.note?.trim());
  if (stored && stored !== wanted)
    return {
      key: withNote ? "capture.duplicate.otherPurposeNote" : "capture.duplicate.otherPurpose",
      purpose: stored,
    };
  return { key: withNote ? "capture.duplicate.note" : "capture.duplicate.unchanged" };
}
