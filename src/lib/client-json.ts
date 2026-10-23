/** A redirected login page or malformed success response must never look like a saved draft. */
export async function postClientJson(
  url: string,
  body: unknown,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean; expired: boolean; data: Record<string, unknown> }> {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const expired =
    response.status === 401 ||
    (response.redirected && new URL(response.url).pathname === "/youtube/login");
  const value: unknown = await response.json().catch(() => null);
  const valid = value !== null && typeof value === "object" && !Array.isArray(value);
  return {
    ok: response.ok && valid && !expired,
    expired,
    data: valid ? (value as Record<string, unknown>) : {},
  };
}
