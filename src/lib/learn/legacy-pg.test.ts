import assert from "node:assert/strict";
import { test } from "node:test";
import { legacySourceTypes, parseLegacyImportDate, type LegacyPgTypes } from "./legacy-pg";

test("pool-local naive timestamp parsing reaches the import UTC mapper without a timezone shift", () => {
  const originalTimezone = process.env.TZ;
  process.env.TZ = "America/Asuncion";
  try {
    const base: LegacyPgTypes = {
      getTypeParser: () => () => {
        throw new Error("The default local-time timestamp parser must not run.");
      },
    };
    const originalLookup = base.getTypeParser;
    const source = legacySourceTypes(base);
    const timestamp = source.getTypeParser(1114, "text")("2025-05-01 12:34:56.789");
    assert.equal(timestamp, "2025-05-01 12:34:56.789");
    assert.equal(parseLegacyImportDate(timestamp)?.toISOString(), "2025-05-01T12:34:56.789Z");
    assert.equal(base.getTypeParser, originalLookup, "the global registry is unchanged");
  } finally {
    if (originalTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimezone;
  }
});

test("pool-local override delegates DATE, zoned timestamps and binary parsers unchanged", () => {
  const calls: Array<[number, "text" | "binary" | undefined]> = [];
  const originalParser = (value: string) => `original:${value}`;
  const source = legacySourceTypes({
    getTypeParser(oid, format) {
      calls.push([oid, format]);
      return originalParser;
    },
  });
  for (const [oid, format] of [
    [1082, "text"],
    [1184, "text"],
    [1114, "binary"],
  ] as const) {
    assert.equal(source.getTypeParser(oid, format), originalParser);
  }
  assert.deepEqual(calls, [
    [1082, "text"],
    [1184, "text"],
    [1114, "binary"],
  ]);
  assert.equal(
    parseLegacyImportDate("2025-05-01T12:34:56-03:00")?.toISOString(),
    "2025-05-01T15:34:56.000Z",
  );
});
