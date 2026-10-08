/**
 * WAV in and out, pure (docs/VOICE.md). ElevenLabs (`pcm_44100`) and Gemini
 * TTS (24 kHz) answer with raw signed 16-bit little-endian PCM; this wraps it
 * in a RIFF header so every take's master is a plain WAV. `parseWav` reads the
 * header back (Azure answers with a RIFF file already) for the duration when
 * ffprobe is not installed.
 */

export type WavInfo = {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  dataOffset: number;
  dataLength: number;
  durationMs: number;
};

/** A 44-byte canonical PCM WAV header plus `pcm`. */
export function pcmToWav(
  pcm: Uint8Array,
  sampleRate: number,
  channels = 1,
  bitsPerSample = 16,
): Buffer {
  const blockAlign = (channels * bitsPerSample) / 8;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * blockAlign, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength)]);
}

/** The header of a PCM WAV, walking its chunks; null for anything else. */
export function parseWav(buf: Uint8Array): WavInfo | null {
  const b = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  if (
    b.length < 12 ||
    b.toString("ascii", 0, 4) !== "RIFF" ||
    b.toString("ascii", 8, 12) !== "WAVE"
  ) {
    return null;
  }
  let offset = 12;
  let fmt: { channels: number; sampleRate: number; bitsPerSample: number } | null = null;
  while (offset + 8 <= b.length) {
    const id = b.toString("ascii", offset, offset + 4);
    const size = b.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === "fmt " && body + 16 <= b.length) {
      fmt = {
        channels: b.readUInt16LE(body + 2),
        sampleRate: b.readUInt32LE(body + 4),
        bitsPerSample: b.readUInt16LE(body + 14),
      };
    } else if (id === "data" && fmt) {
      // Streamed WAVs (Azure) can carry 0 or 0xFFFFFFFF as the data size: use what is there.
      const available = b.length - body;
      const dataLength = size === 0 || size > available ? available : size;
      const bytesPerSecond = fmt.sampleRate * fmt.channels * (fmt.bitsPerSample / 8);
      return {
        ...fmt,
        dataOffset: body,
        dataLength,
        durationMs: bytesPerSecond > 0 ? Math.round((dataLength / bytesPerSecond) * 1000) : 0,
      };
    }
    offset = body + size + (size % 2);
  }
  return null;
}

/**
 * A quiet tone of `durationMs` (the voice test double). `noise` adds a little
 * random dither so two takes of the same text are different files, as two real
 * takes are (assets are identified by content hash).
 */
export function toneWav(opts: {
  durationMs: number;
  sampleRate?: number;
  frequency?: number;
  amplitude?: number;
  noise?: boolean;
}): Buffer {
  const sampleRate = opts.sampleRate ?? 24_000;
  const frequency = opts.frequency ?? 220;
  const amplitude = opts.amplitude ?? 0.08;
  const samples = Math.max(1, Math.round((opts.durationMs / 1000) * sampleRate));
  const pcm = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    const tone = Math.sin((2 * Math.PI * frequency * i) / sampleRate) * amplitude;
    const dither = opts.noise ? (Math.random() - 0.5) * 0.002 : 0;
    const v = Math.max(-1, Math.min(1, tone + dither));
    pcm.writeInt16LE(Math.round(v * 32_767), i * 2);
  }
  return pcmToWav(pcm, sampleRate);
}

/** `audio/L16;codec=pcm;rate=24000` → 24000 (Gemini's inline audio mime type). */
export function sampleRateFromMime(mime: string | null | undefined, fallback = 24_000): number {
  const m = /rate=(\d+)/i.exec(mime ?? "");
  const rate = m ? Number(m[1]) : NaN;
  return Number.isFinite(rate) && rate > 0 ? rate : fallback;
}
