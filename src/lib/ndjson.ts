/**
 * Incremental NDJSON line splitter.
 *
 * A streamed chunk is not a line: one read can carry three events, or half of
 * one. Splitting each chunk independently silently drops the split object, and
 * that failure only shows up under real network conditions — so the buffering
 * lives here, with tests, rather than inline in a component.
 */
export function createNdjsonParser<T>(): (chunk: string) => T[] {
  let buffer = "";

  return (chunk: string): T[] => {
    buffer += chunk;
    const parts = buffer.split("\n");
    // The last part is either "" (chunk ended on a newline) or a partial line.
    buffer = parts.pop() ?? "";

    const out: T[] = [];
    for (const line of parts) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        out.push(JSON.parse(trimmed) as T);
      } catch {
        // A malformed line is dropped rather than killing the stream: losing
        // one progress event is not worth aborting a running ingest over.
      }
    }
    return out;
  };
}
