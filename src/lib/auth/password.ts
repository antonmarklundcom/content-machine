import bcrypt from "bcryptjs";

/**
 * bcryptjs rather than the native `bcrypt`: Hostinger's managed Node slots run
 * `npm install` on their build servers, and a package needing node-gyp is the
 * classic way a deploy that worked locally fails there with a compiler error.
 * Pure JS is slower per hash, which for one login a month does not matter.
 */
const COST = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, COST);
}

/**
 * A null hash (a seeded user who never set a password) must never authenticate.
 * bcrypt.compare against a non-hash returns false, but relying on that is a
 * silent dependency on library behaviour — so it is checked here.
 */
export async function verifyPassword(plain: string, hash: string | null): Promise<boolean> {
  if (!hash) return false;
  return bcrypt.compare(plain, hash);
}
