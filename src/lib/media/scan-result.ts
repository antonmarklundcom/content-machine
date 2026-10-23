export const SCAN_ERROR_DETAIL_LIMIT = 20;

/** Keep useful relative paths and bounded text; never expose the server's root path. */
export function scanErrorDetails(errors: Array<{ path: string; message: string }>, root: string) {
  const rootPattern = root.split(/[/\\]+/).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[/\\\\]+");
  const rootMatch = rootPattern ? new RegExp(rootPattern, "gi") : null;
  const clean = (value: string, limit: number) =>
    (rootMatch ? value.replace(rootMatch, "MEDIA_ROOT") : value)
      .replace(/[\r\n\0]+/g, " ")
      .slice(0, limit);
  return {
    errorDetails: errors.slice(0, SCAN_ERROR_DETAIL_LIMIT).map((error) => ({
      path: clean(error.path, 240),
      message: clean(error.message, 500),
    })),
    errorsTruncated: errors.length > SCAN_ERROR_DETAIL_LIMIT,
  };
}
