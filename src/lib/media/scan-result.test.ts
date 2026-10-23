import assert from "node:assert/strict";
import { test } from "node:test";
import { SCAN_ERROR_DETAIL_LIMIT, scanErrorDetails } from "./scan-result";

test("scan recovery details retain relative files while bounding output and hiding server roots", () => {
  const errors = Array.from({ length: 25 }, (_, index) => ({
    path: `renders/file-${index}.mp4`,
    message: `Cannot read C:\\private-root\\renders\\file-${index}.mp4\nRestore its original.`,
  }));
  const result = scanErrorDetails(errors, "C:\\private-root");
  assert.equal(result.errorDetails.length, SCAN_ERROR_DETAIL_LIMIT);
  assert.equal(result.errorsTruncated, true);
  assert.equal(result.errorDetails[0].path, "renders/file-0.mp4");
  assert.equal(
    result.errorDetails[0].message,
    "Cannot read MEDIA_ROOT\\renders\\file-0.mp4 Restore its original.",
  );
  assert.equal(scanErrorDetails([], "C:\\root").errorsTruncated, false);
  assert.equal(scanErrorDetails([{ path: "file.pdf", message: "Cannot read c:/PRIVATE-ROOT/file.pdf" }], "C:\\private-root").errorDetails[0].message, "Cannot read MEDIA_ROOT/file.pdf");
});
