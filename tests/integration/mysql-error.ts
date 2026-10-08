/** Match the actual native error through ORM wrappers without weakening the expected failure. */
export function hasMysqlError(error: unknown, code: string, message: RegExp): boolean {
  const seen = new Set<object>();
  let current = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const native = current as { code?: string; message?: string; cause?: unknown };
    if (native.code === code && typeof native.message === "string" && message.test(native.message))
      return true;
    current = native.cause;
  }
  return false;
}
