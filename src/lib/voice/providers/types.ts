import type { VoiceProvider, VoiceSettings, WordTiming } from "../contract";

/** What an adapter needs from a voice profile. */
export type SynthesisProfile = {
  provider: VoiceProvider;
  providerVoiceId: string | null;
  settings: VoiceSettings;
};

export type SynthesisResult = {
  /** A complete PCM WAV file. */
  wav: Buffer;
  sampleRate: number;
  /** Word timings for the text that was sent, or null when the provider gives none. */
  alignment: WordTiming[] | null;
  costUsd: number;
  /** The provider model used, for the asset row. */
  model: string | null;
};

/** One voice a provider offers, for the profile form's "load voices". */
export type ProviderVoice = {
  id: string;
  name: string;
  locale?: string | null;
  gender?: string | null;
  description?: string | null;
};

export type SynthesisContext = { language: string };

export interface VoiceAdapter {
  readonly provider: VoiceProvider;
  synthesize(
    text: string,
    profile: SynthesisProfile,
    ctx: SynthesisContext,
  ): Promise<SynthesisResult>;
  listVoices(): Promise<ProviderVoice[]>;
}

/** `fetch`, injectable so the adapters are unit-tested against canned responses. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class ProviderHttpError extends Error {
  constructor(
    readonly provider: VoiceProvider,
    readonly status: number,
    detail: string,
  ) {
    super(`${provider} answered ${status}: ${detail.slice(0, 400)}`);
    this.name = "ProviderHttpError";
  }
}

export async function failOnHttpError(provider: VoiceProvider, res: Response): Promise<void> {
  if (res.ok) return;
  let detail = "";
  try {
    detail = await res.text();
  } catch {
    detail = res.statusText;
  }
  throw new ProviderHttpError(provider, res.status, detail || res.statusText);
}
