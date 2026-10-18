import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto'

const N = 32_768
const R = 8
const P = 1
const KEY_LEN = 64
const MAXMEM = 128 * N * R * 2

function scrypt(password: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password.normalize('NFKC'), salt, KEY_LEN, { N: n, r, p, maxmem: Math.max(MAXMEM, 128 * n * r * 2) }, (err, key) =>
      err ? reject(err) : resolve(key),
    )
  })
}

/** Format: scrypt:N:r:p:salt:hash (base64url). Avoids `$`, which .env variable expansion would mangle. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const key = await scrypt(password, salt, N, R, P)
  return ['scrypt', N, R, P, salt.toString('base64url'), key.toString('base64url')].join(':')
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.trim().split(':')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const [, n, r, p, saltB64, hashB64] = parts
  const expected = Buffer.from(hashB64!, 'base64url')
  if (expected.length !== KEY_LEN) return false
  const key = await scrypt(password, Buffer.from(saltB64!, 'base64url'), Number(n), Number(r), Number(p))
  return timingSafeEqual(key, expected)
}
