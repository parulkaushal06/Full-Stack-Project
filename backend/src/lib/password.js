import crypto from 'node:crypto';

const N = 16384; // CPU/memory cost
const r = 8; // block size
const p = 1; // parallelization
const KEYLEN = 64;

/**
 * Password hashing with Node's built-in scrypt (memory hard KDF).
 * Stored format: scrypt$N$r$p$saltHex$hashHex
 */
export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, KEYLEN, { N, r, p, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${N}$${r}$${p}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  try {
    const [scheme, nStr, rStr, pStr, saltHex, hashHex] = stored.split('$');
    if (scheme !== 'scrypt') return false;
    const expected = Buffer.from(hashHex, 'hex');
    const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length, {
      N: Number(nStr),
      r: Number(rStr),
      p: Number(pStr),
      maxmem: 64 * 1024 * 1024,
    });
    return crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}
