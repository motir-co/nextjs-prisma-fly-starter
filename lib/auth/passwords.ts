import argon2 from 'argon2';

// Argon2id with OWASP 2024 baseline parameters. argon2 is the only place in
// the codebase that touches password hashing primitives; every other caller
// (Better-Auth via the password override in lib/auth/index.ts; the users
// repo for direct-DB code paths) goes through this module's two functions.
// Keep that invariant — it's what makes "no caller can accidentally compare
// a plaintext password" enforceable by spot-check rather than runtime.

const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hash(plain: string): Promise<string> {
  return argon2.hash(plain, ARGON2_OPTIONS);
}

export async function verify(plain: string, hashed: string): Promise<boolean> {
  // argon2.verify throws on malformed hash strings; treat any throw as
  // "does not verify" so a corrupted Account.password row can't crash the
  // sign-in path. Callers see false, not an exception.
  try {
    return await argon2.verify(hashed, plain);
  } catch {
    return false;
  }
}
