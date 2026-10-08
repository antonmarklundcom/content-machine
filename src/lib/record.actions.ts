"use server";

/**
 * The recording studio's reads after each Keep (build 5 §3.B, docs/RECORDING.md):
 * the session's progress and resume point, and minutes recorded per language
 * and profile. Owner only. The Keep itself is the route `POST /voice/record/upload`
 * (recordings are larger than the server-action body limit).
 */

import { ForbiddenError } from "@/lib/auth/roles";
import { requireOwner } from "@/lib/auth/session";
import type { TranslationKey } from "@/lib/i18n";
import { getProfile } from "@/lib/voice/store";
import { parseSourceKey } from "@/lib/voice/record/lines";
import {
  loadRecordSession,
  recordingMinutes,
  type MinutesRow,
  type RecordSession,
} from "@/lib/voice/record/session";

type Failure = { ok: false; error: TranslationKey; detail?: string };

async function asOwner<T extends { ok: boolean }>(
  fn: () => Promise<T | Failure>,
): Promise<T | Failure> {
  try {
    await requireOwner("use the recording studio");
    return await fn();
  } catch (err) {
    // A redirect (signed out) must propagate; everything else becomes a result.
    if (err && typeof err === "object" && "digest" in err) throw err;
    if (err instanceof ForbiddenError) return { ok: false, error: "record.error.owner" };
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: "record.error.failed", detail: message.slice(0, 500) };
  }
}

export type SessionResult = { ok: true; session: RecordSession } | Failure;

/** One session's lines, progress and resume point, fresh from the database. */
export async function recordSessionAction(
  sourceKey: string,
  profileId: number,
): Promise<SessionResult> {
  return asOwner(async () => {
    const source = parseSourceKey(sourceKey);
    const profile =
      Number.isInteger(profileId) && profileId > 0 ? await getProfile(profileId) : null;
    if (!source || !profile) return { ok: false, error: "record.error.notFound" } as const;
    const session = await loadRecordSession(source, sourceKey, profile);
    if (!session) return { ok: false, error: "record.error.notFound" } as const;
    return { ok: true, session } as const;
  });
}

export type MinutesResult = { ok: true; rows: MinutesRow[] } | Failure;

/** Minutes of kept recordings per language and profile (all sources). */
export async function recordingMinutesAction(): Promise<MinutesResult> {
  return asOwner(async () => ({ ok: true, rows: await recordingMinutes() }) as const);
}
