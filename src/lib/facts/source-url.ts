/** Remote fact imports have one trusted origin; local files use the upload path. */
export function factsSourceUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Use an HTTPS raw.githubusercontent.com source URL or upload a file.");
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "raw.githubusercontent.com" ||
    url.username ||
    url.password ||
    url.port
  ) {
    throw new Error(
      "Use an HTTPS raw.githubusercontent.com source URL without credentials or a custom port, or upload a file.",
    );
  }
  return url;
}

/** Count bytes while reading, including when Content-Length is absent or false. */
export async function boundedSourceText(response: Response, limit: number): Promise<string> {
  const size = Number(response.headers.get("content-length"));
  if (Number.isFinite(size) && size > limit) {
    await response.body?.cancel();
    throw new Error("The source file is too large.");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) {
        await reader.cancel();
        throw new Error("The source file is too large.");
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}
