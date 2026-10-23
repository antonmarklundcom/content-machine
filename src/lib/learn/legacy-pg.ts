export type LegacyPgTypes = {
  getTypeParser(oid: number, format?: "text" | "binary"): (value: string) => unknown;
};

/** Keep naive source timestamps intact until the import's explicit UTC conversion. */
export function legacySourceTypes(base: LegacyPgTypes): LegacyPgTypes {
  return {
    getTypeParser(oid, format) {
      if (oid === 1114 && (format === undefined || format === "text")) return (value) => value;
      return base.getTypeParser(oid, format);
    },
  };
}

/** Shared by the import mapper and its pure timestamp regression. */
export function parseLegacyImportDate(v: unknown): Date | null {
  if (v === null || v === undefined || v === "") return null;
  const raw = String(v);
  const naiveTimestamp = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/;
  const d =
    v instanceof Date ? v : new Date(naiveTimestamp.test(raw) ? raw.replace(" ", "T") + "Z" : raw);
  return Number.isNaN(d.getTime()) ? null : d;
}
