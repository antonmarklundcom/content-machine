/**
 * Voice contract (build 4, docs/PLAN-build4.md §2). Pure types and constants,
 * shared by the voice engine (`src/lib/voice/**`), the story studio
 * (`src/lib/stories/**`) and the video renderer (`src/lib/video/**`). Change
 * it only additively: three modules read it.
 */

/** Languages a narration can be in. `jopara` and `gn` are content modes, not BCP-47 tags. */
export const VOICE_LANGUAGES = [
  "es-PY",
  "jopara",
  "gn",
  "en",
  "es",
  "pt-BR",
  "de",
  "nl",
  "sv",
] as const;
export type VoiceLanguage = (typeof VOICE_LANGUAGES)[number];

/**
 * `manual` is an uploaded recording (a native Guaraní speaker, Anton's own
 * voice). It is the only provider allowed for `gn` unless a profile opts in
 * explicitly, because no TTS service speaks Guaraní (§1.4).
 */
export const VOICE_PROVIDERS = [
  "elevenlabs",
  "azure",
  "gemini",
  "manual",
  // Build 5 (docs/PLAN-build5.md): Higgsfield engines through the Claude Code
  // bridge (batch jobs, credits), and Chatterbox (local server or Replicate).
  "higgsfield",
  "chatterbox",
] as const;
export type VoiceProvider = (typeof VOICE_PROVIDERS)[number];

export const VOICE_ROLES = ["narrator", "character"] as const;
export type VoiceRole = (typeof VOICE_ROLES)[number];

/** A cloned or recorded human voice needs `signed` before any take is made (§1.5). */
export const CONSENT_STATUSES = ["not_needed", "pending", "signed", "revoked"] as const;
export type ConsentStatus = (typeof CONSENT_STATUSES)[number];

/** Review states shared by glossary terms and pronunciations. */
export const LEXICON_REVIEW_STATUSES = ["proposed", "approved", "rejected"] as const;
export type LexiconReviewStatus = (typeof LEXICON_REVIEW_STATUSES)[number];

/** Listening review of one take. */
export const TAKE_REVIEW_STATUSES = ["unreviewed", "approved", "rejected"] as const;
export type TakeReviewStatus = (typeof TAKE_REVIEW_STATUSES)[number];

export const NARRATION_OWNER_KINDS = [
  "script",
  "post",
  "story_scene",
  "voice_test",
  "free",
] as const;
export type NarrationOwnerKind = (typeof NARRATION_OWNER_KINDS)[number];

export const NARRATION_STATUSES = ["pending", "done", "failed"] as const;
export type NarrationStatus = (typeof NARRATION_STATUSES)[number];

/** Provider knobs. Every field is optional; an adapter ignores what it does not know. */
export type VoiceSettings = {
  /** Provider model, e.g. `eleven_multilingual_v2`, `gemini-2.5-flash-preview-tts`. */
  model?: string;
  /** ElevenLabs 0–1. */
  stability?: number;
  similarity?: number;
  style?: number;
  /** Speaking speed multiplier, 0.7–1.2. Bedtime stories sit around 0.9. */
  speed?: number;
  /** Azure SSML `<mstts:express-as style>`. */
  azureStyle?: string;
  /** Azure prosody pitch, e.g. "-2%". */
  pitch?: string;
  /** Gemini TTS style prompt, e.g. "cálida, pausada, acento paraguayo". */
  instructions?: string;
  /** Build 5: which Higgsfield engine and voice speaks (provider `higgsfield`). */
  higgsfield?: HiggsfieldVoiceSettings;
  /** Build 5: Chatterbox mode and the reference sample it clones (provider `chatterbox`). */
  chatterbox?: ChatterboxVoiceSettings;
};

/** Higgsfield's text-to-speech models (models_explore type audio, 2026-10-07). */
export const HIGGSFIELD_TTS_MODELS = [
  "text2speech_v2",
  "elevenlabs_v4",
  "elevenlabs_v4_turbo",
  "seed_audio",
  "qwen_audio_tts",
] as const;
export type HiggsfieldTtsModel = (typeof HIGGSFIELD_TTS_MODELS)[number];

/** Engines behind `text2speech_v2`'s `variant`. */
export const HIGGSFIELD_TTS_VARIANTS = [
  "elevenlabs",
  "minimax",
  "seed_speech",
  "vibe_voice",
  "cozy_voice",
] as const;
export type HiggsfieldTtsVariant = (typeof HIGGSFIELD_TTS_VARIANTS)[number];

export type HiggsfieldVoiceSettings = {
  model: HiggsfieldTtsModel;
  /** Required for `text2speech_v2`. */
  variant?: HiggsfieldTtsVariant;
  /** `preset` = a built-in voice; `element` = a voice cloned in Higgsfield (needs consent). */
  voiceType: "preset" | "element";
  voiceId: string;
};

export type ChatterboxVoiceSettings = {
  /** `local` = the Python server on this PC (CHATTERBOX_URL); `replicate` = REPLICATE_API_TOKEN. */
  mode: "local" | "replicate";
  /** The ~10 s voice sample it clones, relative to MEDIA_ROOT. */
  referencePath?: string;
  /** 0.25–2, emotion intensity (default 0.5). */
  exaggeration?: number;
  /** 0–1, pacing/adherence (default 0.5). */
  cfgWeight?: number;
  /** Model language id, default "es". */
  languageId?: string;
};

/** One spoken word with its time in the take. Captions are built from these. */
export type WordTiming = { word: string; startMs: number; endMs: number };

export type NarrateRequest = {
  ownerKind: NarrationOwnerKind;
  /** e.g. `"script:12"`, `"story:tito-salto-chiquito"`, `"voice-test:2026-10-07"`. */
  ownerRef: string;
  /** Scene or section id inside the owner (`"S01"`), null for a whole-owner take. */
  sceneRef?: string | null;
  language: VoiceLanguage;
  voiceProfileId: number;
  /** The approved text, verbatim. The engine applies pronunciations; callers never respell. */
  text: string;
  /** Character key for dialogue lines; null means the narrator. */
  speaker?: string | null;
  /** Pronunciation scope beyond `global`, e.g. `"story:tito-salto-chiquito"` or `"brand:propia"`. */
  pronunciationScope?: string | null;
};

export type NarrateResult = {
  narrationId: number;
  durationMs: number;
  /** Relative to MEDIA_ROOT. Clean master (WAV). */
  masterPath: string;
  /** Relative to MEDIA_ROOT. Compressed playback (MP3). */
  playbackPath: string;
  /** Null when the provider gives no timings; captions then fall back to proportional timing. */
  alignment: WordTiming[] | null;
  costUsd: number;
};

/** Refusals the engine raises instead of narrating (§1.3, §1.5). Callers show `message` as is. */
export class NarrationRefusedError extends Error {
  constructor(
    readonly reason:
      | "consent_missing"
      | "provider_not_configured"
      | "language_not_supported"
      | "text_not_approved"
      | "empty_text"
      // Build 5: a provider whose takes are made in a batch job (Higgsfield), not here.
      | "queued_provider",
    message: string,
  ) {
    super(message);
    this.name = "NarrationRefusedError";
  }
}

/**
 * An uploaded recording becomes a take like any other (provider `manual`):
 * normalised to a WAV master + MP3 playback copy, measured, registered.
 * This is how Guaraní is voiced (§1.4).
 */
export type ImportRecordingRequest = Omit<NarrateRequest, "voiceProfileId"> & {
  /** The speaker's profile when there is one (consent is then checked); null = unnamed recording. */
  voiceProfileId: number | null;
  /** Absolute path to the uploaded file (any ffmpeg-readable audio). The engine copies it; the caller may delete it after. */
  filePath: string;
};
