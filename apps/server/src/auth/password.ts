import * as argon2 from "argon2";

const isTest = process.env.NODE_ENV === "test";

const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: isTest ? 1024 : 19456, // 1 MiB in test, 19 MiB in prod
  timeCost: isTest ? 1 : 2, // 1 iteration in test, 2 in prod
  parallelism: 1,
};

/**
 * Hash a plain password using argon2id.
 */
export async function hashPassword(password: string): Promise<string> {
  return await argon2.hash(password, ARGON2_OPTIONS);
}

/**
 * Verify a plain password against an argon2id hash.
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}
