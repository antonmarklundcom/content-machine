/**
 * Compare Telegram's `X-Telegram-Bot-Api-Secret-Token` with ours in constant
 * time. Both sides are hashed first, so the loop always runs over 32 bytes and
 * neither the length nor the first differing byte of the secret leaks through
 * timing.
 */
export async function secretsMatch(presented: string | null, expected: string): Promise<boolean> {
  if (presented === null) return false;
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(presented)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const left = new Uint8Array(a);
  const right = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left[i]! ^ right[i]!;
  return diff === 0;
}
