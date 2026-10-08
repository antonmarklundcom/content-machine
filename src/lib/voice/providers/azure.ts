import { estimateTakeUsd } from "../costs";
import { buildSsml } from "../ssml";
import { parseWav } from "../wav";
import {
  failOnHttpError,
  type FetchLike,
  type ProviderVoice,
  type SynthesisResult,
  type VoiceAdapter,
} from "./types";

/**
 * Azure Speech REST (docs/VOICE.md): the stock es-PY voices
 * (`es-PY-TaniaNeural`, `es-PY-MarioNeural`). Answers with a RIFF WAV; no
 * word timings on this endpoint. Live path UNVERIFIED until a key is set.
 */

export const AZURE_OUTPUT_FORMAT = "riff-24khz-16bit-mono-pcm";

export function azureHost(region: string): string {
  const clean = region.trim().toLowerCase();
  if (!/^[a-z0-9-]+$/.test(clean)) throw new Error(`Not an Azure region: "${region}".`);
  return `https://${clean}.tts.speech.microsoft.com`;
}

export function azureAdapter(opts: {
  key: string;
  region: string;
  fetch?: FetchLike;
}): VoiceAdapter {
  const doFetch: FetchLike = opts.fetch ?? ((input, init) => fetch(input, init));
  return {
    provider: "azure",
    async synthesize(text, profile, ctx): Promise<SynthesisResult> {
      const ssml = buildSsml({
        text,
        voiceName: profile.providerVoiceId ?? "",
        language: ctx.language,
        style: profile.settings.azureStyle,
        speed: profile.settings.speed,
        pitch: profile.settings.pitch,
      });
      const res = await doFetch(`${azureHost(opts.region)}/cognitiveservices/v1`, {
        method: "POST",
        headers: {
          "Ocp-Apim-Subscription-Key": opts.key,
          "Content-Type": "application/ssml+xml",
          "X-Microsoft-OutputFormat": AZURE_OUTPUT_FORMAT,
          "User-Agent": "content-engine",
        },
        body: ssml,
      });
      await failOnHttpError("azure", res);
      const wav = Buffer.from(await res.arrayBuffer());
      const info = parseWav(wav);
      if (!info) throw new Error("Azure Speech answered with something that is not a WAV file.");
      return {
        wav,
        sampleRate: info.sampleRate,
        alignment: null,
        costUsd: estimateTakeUsd("azure", text),
        model: "azure-neural",
      };
    },
    async listVoices(): Promise<ProviderVoice[]> {
      const res = await doFetch(`${azureHost(opts.region)}/cognitiveservices/voices/list`, {
        headers: { "Ocp-Apim-Subscription-Key": opts.key },
      });
      await failOnHttpError("azure", res);
      const json = (await res.json()) as Array<{
        ShortName: string;
        DisplayName?: string;
        LocalName?: string;
        Locale?: string;
        Gender?: string;
        StyleList?: string[];
      }>;
      return json.map((v) => ({
        id: v.ShortName,
        name: v.LocalName || v.DisplayName || v.ShortName,
        locale: v.Locale ?? null,
        gender: v.Gender ?? null,
        description: v.StyleList?.length ? `styles: ${v.StyleList.join(", ")}` : null,
      }));
    },
  };
}
