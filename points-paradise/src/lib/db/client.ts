import fs from 'node:fs'
import path from 'node:path'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import * as schema from './schema'
import { ensureReferenceData } from './seed-reference'

export type AppDb = PgDatabase<PgQueryResultHKT, typeof schema>

export const MIGRATIONS_FOLDER = path.join(process.cwd(), 'drizzle')

/** In-memory or file-backed embedded Postgres, migrated and seeded with reference data. */
export async function createPgliteDb(dataDir?: string): Promise<AppDb> {
  const { PGlite } = await import('@electric-sql/pglite')
  const { drizzle } = await import('drizzle-orm/pglite')
  const { migrate } = await import('drizzle-orm/pglite/migrator')
  if (dataDir) fs.mkdirSync(dataDir, { recursive: true })
  const client = dataDir ? new PGlite(dataDir) : new PGlite()
  const db = drizzle(client, { schema })
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })
  const appDb = db as unknown as AppDb
  await ensureReferenceData(appDb)
  return appDb
}

async function createPostgresDb(url: string): Promise<AppDb> {
  const { default: postgres } = await import('postgres')
  const { drizzle } = await import('drizzle-orm/postgres-js')
  // prepare:false keeps the client compatible with Supabase's transaction pooler.
  const client = postgres(url, { prepare: false, max: Number(process.env.DATABASE_POOL_MAX ?? 3) })
  const db = drizzle(client, { schema }) as unknown as AppDb
  await ensureReferenceData(db)
  return db
}

const g = globalThis as unknown as { __ppDb?: Promise<AppDb> }

/**
 * Shared database handle. Uses DATABASE_URL (Supabase/Postgres) when set,
 * otherwise an embedded PGlite database under .data/ for local development.
 */
export function getDb(): Promise<AppDb> {
  if (!g.__ppDb) {
    const url = process.env.DATABASE_URL
    let p: Promise<AppDb>
    if (url) p = createPostgresDb(url)
    else if (process.env.NODE_ENV === 'production' && process.env.ALLOW_PGLITE !== 'true') {
      p = Promise.reject(new Error('DATABASE_URL is not set. Configure a Postgres/Supabase connection string (see .env.example).'))
    } else p = createPgliteDb(process.env.PGLITE_DIR ?? path.join(process.cwd(), '.data', 'pglite'))
    // Do not cache failures, so a fixed configuration works without a restart.
    g.__ppDb = p.catch((err) => {
      g.__ppDb = undefined
      throw err
    })
  }
  return g.__ppDb
}
