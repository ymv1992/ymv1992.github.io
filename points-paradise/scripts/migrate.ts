/** Applies SQL migrations in ./drizzle to DATABASE_URL (or the local PGlite database). */
import path from 'node:path'
import { MIGRATIONS_FOLDER, createPgliteDb } from '../src/lib/db/client'

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) {
    const dir = process.env.PGLITE_DIR ?? path.join(process.cwd(), '.data', 'pglite')
    await createPgliteDb(dir)
    console.log(`Migrated local PGlite database at ${dir}`)
    return
  }
  const { default: postgres } = await import('postgres')
  const { drizzle } = await import('drizzle-orm/postgres-js')
  const { migrate } = await import('drizzle-orm/postgres-js/migrator')
  const client = postgres(url, { prepare: false, max: 1 })
  await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER })
  await client.end()
  console.log('Migrations applied to DATABASE_URL')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
