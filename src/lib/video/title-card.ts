/**
 * Title cards: a section with no b-roll gets its on-screen text on the brand
 * kit colour. The SVG is pure (unit-tested); `renderTitleCard()` rasterises it
 * with sharp.
 */

export const DEFAULT_CARD_COLOR = "#1f2937";

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** `#rgb` / `#rrggbb`, else the default. */
export function cardColor(hex: string | null | undefined): string {
  const value = hex?.trim() ?? "";
  if (/^#[0-9a-f]{6}$/i.test(value)) return value.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(value)) {
    const [r, g, b] = value.slice(1);
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return DEFAULT_CARD_COLOR;
}

/** Dark text on a light colour, white on a dark one (relative luminance). */
export function textColorFor(background: string): string {
  const hex = cardColor(background).slice(1);
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.4 ? "#111111" : "#ffffff";
}

/** Greedy word wrap to `maxChars`, at most `maxLines` (the last line ends in "…" when cut). */
export function wrapCardText(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const w of words) {
    const next = current ? `${current} ${w}` : w;
    if (current && next.length > maxChars) {
      lines.push(current);
      current = w;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = `${kept[maxLines - 1].replace(/[.,;:!?…]*$/, "")}…`;
    return kept;
  }
  return lines;
}

export function titleCardSvg(input: {
  width: number;
  height: number;
  text: string;
  background?: string | null;
}): string {
  const { width, height } = input;
  const bg = cardColor(input.background);
  const fg = textColorFor(bg);
  const portrait = height > width;
  const maxChars = portrait ? 16 : width === height ? 18 : 26;
  const lines = wrapCardText(input.text, maxChars, 5);
  const fontSize = Math.round(
    (portrait ? width : Math.min(width, height * 1.4)) / (maxChars * 0.72),
  );
  const lineHeight = Math.round(fontSize * 1.2);
  const top = height / 2 - ((lines.length - 1) * lineHeight) / 2;
  const tspans = lines
    .map(
      (line, i) =>
        `<text x="${width / 2}" y="${Math.round(top + i * lineHeight)}" text-anchor="middle" dominant-baseline="middle">${escapeXml(line)}</text>`,
    )
    .join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<rect width="100%" height="100%" fill="${bg}"/>` +
    `<g fill="${fg}" font-family="DejaVu Sans, Arial, Helvetica, sans-serif" font-weight="700" font-size="${fontSize}">${tspans}</g>` +
    `</svg>`
  );
}

/** Rasterise a title card to `outFile` (PNG). */
export async function renderTitleCard(
  outFile: string,
  input: Parameters<typeof titleCardSvg>[0],
): Promise<void> {
  const { default: sharp } = await import("sharp");
  await sharp(Buffer.from(titleCardSvg(input)))
    .png()
    .toFile(outFile);
}
