/**
 * Generates OWNER_PASSWORD_HASH for .env. Usage:
 *   npm run hash-password -- 'your long passphrase'
 * or run without arguments and type the passphrase on stdin.
 */
import { hashPassword } from '../src/lib/auth/password'

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const c of process.stdin) chunks.push(c as Buffer)
  return Buffer.concat(chunks).toString('utf8').trim()
}

async function main() {
  const pw = process.argv[2] ?? (await readStdin())
  if (!pw || pw.length < 12) {
    console.error('Use a passphrase of at least 12 characters.')
    process.exit(1)
  }
  console.log(await hashPassword(pw))
}

main()
