export const LEARN_MATERIAL_MAX_CHARS = 100_000;

export function parseLearnMaterial(
  clipId: unknown,
  caption: unknown,
  transcript: unknown,
): { clipId: number; caption: string | null; transcript: string | null } | null {
  if (typeof clipId !== "number" || !Number.isSafeInteger(clipId) || clipId <= 0) return null;
  if (typeof caption !== "string" || typeof transcript !== "string") return null;
  if (caption.length > LEARN_MATERIAL_MAX_CHARS || transcript.length > LEARN_MATERIAL_MAX_CHARS)
    return null;
  return { clipId, caption: caption.trim() || null, transcript: transcript.trim() || null };
}
