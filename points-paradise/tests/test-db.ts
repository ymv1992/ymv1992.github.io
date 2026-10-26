import { createPgliteDb, MIGRATIONS_FOLDER, type AppDb } from '@/lib/db/client'
import * as schema from '@/lib/db/schema'
import { ensureReferenceData } from '@/lib/db/seed-reference'

/**
 * A fresh, migrated database for one test file. Uses in-memory PGlite by
 * default. With TEST_DATABASE_URL set (a Postgres server you can create
 * databases on), each file gets its own new database through the same
 * postgres-js driver production uses, which catches driver-specific bugs
 * such as how parameters are serialized.
 */
export async function createTestDb(): Promise<AppDb> {
  const url = process.env.TEST_DATABASE_URL
  if (!url) return createPgliteDb()
  const { default: postgres } = await import('postgres')
  const { drizzle } = await import('drizzle-orm/postgres-js')
  const { migrate } = await import('drizzle-orm/postgres-js/migrator')
  const name = `pp_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const admin = postgres(url, { max: 1, onnotice: () => {} })
  await admin.unsafe(`create database ${name}`)
  await admin.end()
  const dbUrl = new URL(url)
  dbUrl.pathname = `/${name}`
  const client = postgres(dbUrl.toString(), { prepare: false, max: 3, onnotice: () => {} })
  const db = drizzle(client, { schema })
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })
  const appDb = db as unknown as AppDb
  await ensureReferenceData(appDb)
  return appDb
}
