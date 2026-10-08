/**
 * LJSpeech `metadata.csv`: `id|text|normalized_text`, pipe-separated, no
 * header, one line per clip. Pure.
 */

/**
 * One field: Unicode NFC (Guaraní ã ẽ ĩ õ ũ ỹ g̃ and the puso ' stay), line
 * breaks and tabs collapsed to one space, a `|` (the separator) replaced by
 * ` / `, outer whitespace trimmed.
 */
export function cleanField(value: string): string {
  return value
    .normalize("NFC")
    .replace(/\|/g, " / ")
    .replace(/[\r\n\t\u2028\u2029]+/g, " ")
    .replace(/ {2,}/g, " ")
    .trim();
}

export type MetadataRow = { id: string; text: string; normalized: string };

export function metadataLine(row: MetadataRow): string {
  return [cleanField(row.id), cleanField(row.text), cleanField(row.normalized)].join("|");
}

/** The whole file, `\n` line ends, trailing newline. */
export function metadataCsv(rows: MetadataRow[]): string {
  return rows.map(metadataLine).join("\n") + (rows.length ? "\n" : "");
}
