export type RecoveredDraft<T> = { version: 1; base: string; value: T; savedAt: number };

export function draftKey(
  userId: number,
  brandId: string,
  kind: "post" | "script",
  id: number,
): string {
  return `content-engine:draft:${userId}:${encodeURIComponent(brandId)}:${kind}:${id}`;
}

export function readDraft<T>(
  raw: string | null,
  validate: (value: unknown) => value is T,
  now = Date.now(),
): RecoveredDraft<T> | null {
  if (!raw) return null;
  try {
    const row = JSON.parse(raw) as Partial<RecoveredDraft<unknown>>;
    if (
      row.version !== 1 ||
      typeof row.base !== "string" ||
      typeof row.savedAt !== "number" ||
      now - row.savedAt > 7 * 24 * 60 * 60_000 ||
      !validate(row.value)
    )
      return null;
    return row as RecoveredDraft<T>;
  } catch {
    return null;
  }
}

export function writeDraft<T>(base: string, value: T, now = Date.now()): string {
  return JSON.stringify({ version: 1, base, value, savedAt: now } satisfies RecoveredDraft<T>);
}
