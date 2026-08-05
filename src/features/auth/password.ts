import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

// Hand-rolled rather than promisify: promisify collapses to a single overload
// and drops the options argument, which is where the work factor lives.
function scryptAsync(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

/**
 * scrypt parameters. N is the work factor and dominates both cost and memory:
 * memory ≈ 128 * N * r bytes, so N=32768, r=8 needs ~33.5 MB — above Node's
 * 32 MB default, hence the explicit maxmem.
 *
 * These live in the encoded hash rather than only here, so raising them later
 * does not invalidate existing passwords: an old hash still verifies with the
 * parameters it was written with.
 */
const PARAMS = { N: 32_768, r: 8, p: 1 } as const;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
const MAXMEM = 64 * 1024 * 1024;
const PREFIX = "scrypt";

function encode(salt: Buffer, key: Buffer, params: typeof PARAMS): string {
  return [
    PREFIX,
    String(params.N),
    String(params.r),
    String(params.p),
    salt.toString("base64"),
    key.toString("base64"),
  ].join("$");
}

type ParsedHash = { N: number; r: number; p: number; salt: Buffer; key: Buffer };

function decode(encoded: string): ParsedHash | null {
  const parts = encoded.split("$");
  if (parts.length !== 6) return null;

  const [prefix, rawN, rawR, rawP, rawSalt, rawKey] = parts;
  if (prefix !== PREFIX || !rawN || !rawR || !rawP || !rawSalt || !rawKey) return null;

  const N = Number(rawN);
  const r = Number(rawR);
  const p = Number(rawP);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return null;

  try {
    return { N, r, p, salt: Buffer.from(rawSalt, "base64"), key: Buffer.from(rawKey, "base64") };
  } catch {
    return null;
  }
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await scryptAsync(password.normalize("NFKC"), salt, KEY_LENGTH, {
    ...PARAMS,
    maxmem: MAXMEM,
  });

  return encode(salt, key, PARAMS);
}

/**
 * Returns false rather than throwing on a malformed or missing hash, so a
 * corrupted row cannot be distinguished from a wrong password by the caller.
 */
export async function verifyPassword(
  password: string,
  encoded: string | null | undefined,
): Promise<boolean> {
  if (!encoded) return false;

  const parsed = decode(encoded);
  if (!parsed) return false;

  try {
    const candidate = await scryptAsync(
      password.normalize("NFKC"),
      parsed.salt,
      parsed.key.length,
      {
        N: parsed.N,
        r: parsed.r,
        p: parsed.p,
        maxmem: MAXMEM,
      },
    );

    // Length is checked first because timingSafeEqual throws on a mismatch.
    if (candidate.length !== parsed.key.length) return false;
    return timingSafeEqual(candidate, parsed.key);
  } catch {
    return false;
  }
}

/**
 * Burn comparable CPU time when no account exists for the submitted email.
 * Without this, a fast rejection tells an attacker the address is unregistered.
 */
export async function fakeVerifyDelay(): Promise<void> {
  await hashPassword(randomBytes(16).toString("hex"));
}
