import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach } from "node:test";

/** Isolate fixture files and classification markers; this does not approve any identity. */
export function configureSyntheticMediaRoot(prefix: string): void {
  const original = process.env.MEDIA_ROOT;
  let root = "";
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), `content-machine-${prefix}-`));
    process.env.MEDIA_ROOT = root;
  });
  afterEach(() => {
    try {
      if (root) {
        assert.equal(path.dirname(root), path.resolve(tmpdir()));
        rmSync(root, { recursive: true, force: true });
        root = "";
      }
    } finally {
      if (original === undefined) delete process.env.MEDIA_ROOT;
      else process.env.MEDIA_ROOT = original;
    }
  });
}
