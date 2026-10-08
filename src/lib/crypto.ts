import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Tokens at rest (PLAN.md §1.50): AES-256-GCM with `ENCRYPTION_KEY`, 32 bytes
 * written as 64 hex characters. The stored form is
 * `v1:<iv b64>:<tag b64>:<ciphertext b64>`, so a later key or cipher change
 * can tell old rows apart. Nothing here logs a plaintext or a key.
 */

const VERSION = "v1";
const IV_BYTES = 12;

/** `ENCRYPTION_KEY` is missing or malformed: integrations are disabled (§4.5). */
export class EncryptionKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EncryptionKeyError";
  }
}

/** A ciphertext that does not open with the current key (wrong key, or tampered). */
export class DecryptError extends Error {
  constructor(message = "The stored token could not be decrypted with ENCRYPTION_KEY.") {
    super(message);
    this.name = "DecryptError";
  }
}

export function encryptionKeyProblem(raw = process.env.ENCRYPTION_KEY): string | null {
  if (!raw) return "ENCRYPTION_KEY is not set, so connections to Meta are switched off.";
  if (!/^[0-9a-fA-F]{64}$/.test(raw.trim())) {
    return "ENCRYPTION_KEY must be 64 hex characters (32 bytes).";
  }
  return null;
}

function key(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  const problem = encryptionKeyProblem(raw);
  if (problem) throw new EncryptionKeyError(problem);
  return Buffer.from(raw!.trim(), "hex");
}

/** A fresh key in the format `ENCRYPTION_KEY` expects. */
export function generateEncryptionKey(): string {
  return randomBytes(32).toString("hex");
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(":");
}

export function decryptSecret(stored: string): string {
  const parts = stored.split(":");
  if (parts.length !== 4 || parts[0] !== VERSION) throw new DecryptError("Unknown token format.");
  const [, iv, tag, ct] = parts.map((p) => Buffer.from(p, "base64"));
  try {
    const decipher = createDecipheriv("aes-256-gcm", key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  } catch (err) {
    if (err instanceof EncryptionKeyError) throw err;
    throw new DecryptError();
  }
}
