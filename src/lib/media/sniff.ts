import type { AssetKind } from "@/db/schema";

/**
 * What a file is, from its first bytes (PLAN.md §5.O10.3) — never from its
 * name alone, since a Higgsfield download or a phone export can carry the
 * wrong extension. Pure: the caller reads the header.
 */

export type Sniffed = { mime: string; kind: AssetKind; ext: string };

/** Bytes to read for `sniffMime`. */
export const SNIFF_BYTES = 64;

function ascii(buf: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...buf.subarray(start, start + length));
}

function startsWith(buf: Uint8Array, bytes: number[], offset = 0): boolean {
  if (buf.length < offset + bytes.length) return false;
  return bytes.every((b, i) => buf[offset + i] === b);
}

/** The media type of a file header, or null for anything the library does not hold. */
export function sniffMime(buf: Uint8Array): Sniffed | null {
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { mime: "image/png", kind: "image", ext: "png" };
  }
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return { mime: "image/jpeg", kind: "image", ext: "jpg" };
  if (ascii(buf, 0, 6) === "GIF87a" || ascii(buf, 0, 6) === "GIF89a") {
    return { mime: "image/gif", kind: "image", ext: "gif" };
  }
  if (ascii(buf, 0, 4) === "RIFF") {
    const type = ascii(buf, 8, 4);
    if (type === "WEBP") return { mime: "image/webp", kind: "image", ext: "webp" };
    if (type === "WAVE") return { mime: "audio/wav", kind: "audio", ext: "wav" };
  }
  if (ascii(buf, 4, 4) === "ftyp") {
    const brand = ascii(buf, 8, 4);
    if (brand === "avif" || brand === "avis") return { mime: "image/avif", kind: "image", ext: "avif" };
    if (["heic", "heix", "mif1", "msf1"].includes(brand)) return { mime: "image/heic", kind: "image", ext: "heic" };
    if (brand === "qt  ") return { mime: "video/quicktime", kind: "video", ext: "mov" };
    if (brand === "M4A " || brand === "M4B ") return { mime: "audio/mp4", kind: "audio", ext: "m4a" };
    return { mime: "video/mp4", kind: "video", ext: "mp4" };
  }
  if (startsWith(buf, [0x1a, 0x45, 0xdf, 0xa3])) return { mime: "video/webm", kind: "video", ext: "webm" };
  if (ascii(buf, 0, 3) === "ID3" || (buf.length > 1 && buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)) {
    return { mime: "audio/mpeg", kind: "audio", ext: "mp3" };
  }
  if (ascii(buf, 0, 4) === "OggS") return { mime: "audio/ogg", kind: "audio", ext: "ogg" };
  if (ascii(buf, 0, 5) === "%PDF-") return { mime: "application/pdf", kind: "document", ext: "pdf" };
  return null;
}
