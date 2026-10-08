/**
 * Azure Speech SSML (docs/VOICE.md). Pure. The text is XML-escaped; style and
 * pitch are validated rather than escaped, since they are attribute values a
 * malformed one would break the whole request on.
 */

export function xmlEscape(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** `xml:lang` for a voice: its own locale (`es-PY-TaniaNeural` → `es-PY`), else from the content language. */
export function ssmlLang(voiceName: string, language: string): string {
  const m = /^([a-z]{2,3}-[A-Z]{2,3})-/.exec(voiceName);
  if (m) return m[1];
  switch (language) {
    case "es-PY":
    case "jopara":
      return "es-PY";
    case "es":
      return "es-ES";
    case "en":
      return "en-US";
    case "pt-BR":
      return "pt-BR";
    case "de":
      return "de-DE";
    case "nl":
      return "nl-NL";
    case "sv":
      return "sv-SE";
    default:
      return "es-PY";
  }
}

/** Speed multiplier → SSML relative rate: 0.9 → `-10%`, 1 → null (no prosody needed). */
export function speedToRate(speed: number | undefined): string | null {
  if (speed === undefined || !Number.isFinite(speed) || speed <= 0) return null;
  const pct = Math.round((speed - 1) * 100);
  if (pct === 0) return null;
  return `${pct > 0 ? "+" : ""}${pct}%`;
}

const PITCH = /^([+-]?\d{1,3}(\.\d+)?(%|Hz|st)|x-low|low|medium|high|x-high|default)$/;
const STYLE = /^[a-z][a-z-]{0,40}$/i;

export function buildSsml(opts: {
  text: string;
  voiceName: string;
  language: string;
  style?: string | null;
  speed?: number;
  pitch?: string | null;
}): string {
  const lang = ssmlLang(opts.voiceName, opts.language);
  const rate = speedToRate(opts.speed);
  const pitch = opts.pitch && PITCH.test(opts.pitch.trim()) ? opts.pitch.trim() : null;
  const style = opts.style && STYLE.test(opts.style.trim()) ? opts.style.trim() : null;

  let inner = xmlEscape(opts.text);
  if (rate || pitch) {
    const attrs = [rate ? `rate="${rate}"` : "", pitch ? `pitch="${pitch}"` : ""]
      .filter(Boolean)
      .join(" ");
    inner = `<prosody ${attrs}>${inner}</prosody>`;
  }
  if (style) inner = `<mstts:express-as style="${style}">${inner}</mstts:express-as>`;
  return (
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" ` +
    `xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="${lang}">` +
    `<voice name="${xmlEscape(opts.voiceName)}">${inner}</voice></speak>`
  );
}
