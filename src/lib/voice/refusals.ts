import { NarrationRefusedError, type ConsentStatus, type VoiceProvider } from "./contract";

/**
 * Why a take is refused before anything is spent (docs/PLAN-build4.md §1.3–1.5).
 * Pure: the engine passes the profile row and whether the provider has its key.
 * Every refusal is a `NarrationRefusedError` whose message the UI shows as is.
 */

export type RefusalProfile = {
  key: string;
  name: string;
  provider: VoiceProvider;
  providerVoiceId: string | null;
  languages: string[];
  active: boolean;
  consentStatus: ConsentStatus;
  consentPerson?: string | null;
  consentExpiresAt: Date | null;
};

/** The pending-review notices that always refuse (§1.3). `TODO` and friends are case-sensitive: "todo" is Spanish. */
const PENDING_MARKERS: RegExp[] = [
  /PENDIENTE/,
  /REVISAR/,
  /\bTODO\b/,
  /pending review/i,
  /\[\?\?\]/,
];

export function pendingReviewMarker(text: string): string | null {
  for (const re of PENDING_MARKERS) {
    const m = re.exec(text);
    if (m) return m[0];
  }
  return null;
}

export function assertTextUsable(text: string): void {
  if (!text.trim()) throw new NarrationRefusedError("empty_text", "There is no text to narrate.");
  const marker = pendingReviewMarker(text);
  if (marker) {
    throw new NarrationRefusedError(
      "text_not_approved",
      `The text still carries a pending-review notice (“${marker}”). Approve the text first.`,
    );
  }
}

/** §1.5: a cloned or recorded person's voice only while consent is signed and current. */
export function assertConsent(profile: RefusalProfile, now: Date = new Date()): void {
  if (profile.consentStatus === "not_needed") return;
  const who = profile.consentPerson ? ` from ${profile.consentPerson}` : "";
  if (profile.consentStatus !== "signed") {
    throw new NarrationRefusedError(
      "consent_missing",
      `Voice “${profile.name}” needs a signed consent${who} (status: ${profile.consentStatus}). ` +
        "Upload the signed consent on the voice profile.",
    );
  }
  if (profile.consentExpiresAt && profile.consentExpiresAt.getTime() <= now.getTime()) {
    throw new NarrationRefusedError(
      "consent_missing",
      `The consent for voice “${profile.name}” expired on ${profile.consentExpiresAt.toISOString().slice(0, 10)}. ` +
        "Renew it on the voice profile before making takes.",
    );
  }
}

/** Is the voice allowed for this language? TTS never speaks Guaraní (§1.4). */
export function assertLanguage(profile: RefusalProfile, language: string): void {
  if (language === "gn" && profile.provider !== "manual") {
    throw new NarrationRefusedError(
      "language_not_supported",
      "No TTS voice speaks Guaraní. Guaraní takes are recorded by a native speaker and uploaded as a recording.",
    );
  }
  if (profile.languages.length && !profile.languages.includes(language)) {
    throw new NarrationRefusedError(
      "language_not_supported",
      `Voice “${profile.name}” is not set up for ${language} (it has ${profile.languages.join(", ")}). ` +
        "Add the language on the voice profile if it really speaks it.",
    );
  }
}

/** Every check `narrate()` makes before synthesis, in order. */
export function assertCanSynthesize(
  profile: RefusalProfile,
  req: { text: string; language: string },
  configured: { ok: true } | { ok: false; message: string },
  now: Date = new Date(),
): void {
  assertTextUsable(req.text);
  // The contract has no `inactive` reason; a switched-off voice is "not configured" for use.
  if (!profile.active) {
    throw new NarrationRefusedError(
      "provider_not_configured",
      `Voice “${profile.name}” is switched off. Turn it on in Voice profiles first.`,
    );
  }
  assertLanguage(profile, req.language);
  assertConsent(profile, now);
  if (profile.provider === "manual") {
    throw new NarrationRefusedError(
      "provider_not_configured",
      `Voice “${profile.name}” is a recorded voice (manual): upload a recording instead of generating one.`,
    );
  }
  // Chatterbox has no voice id: it clones the profile's reference sample (its adapter checks that).
  if (profile.provider !== "chatterbox" && !profile.providerVoiceId?.trim()) {
    throw new NarrationRefusedError(
      "provider_not_configured",
      `Voice “${profile.name}” has no ${profile.provider} voice id. Set it on the voice profile.`,
    );
  }
  if (!configured.ok)
    throw new NarrationRefusedError("provider_not_configured", configured.message);
}
