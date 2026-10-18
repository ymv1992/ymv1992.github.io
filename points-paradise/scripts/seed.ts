/**
 * Inserts reference data (transfer partners, data sources) and, with --demo,
 * the clearly labelled fictional demo deals. Safe to run repeatedly.
 */
import { getDb } from '../src/lib/db/client'
import { seedDemoData } from '../src/lib/db/seed-demo'
import { ensureReferenceData } from '../src/lib/db/seed-reference'

async function main() {
  const db = await getDb()
  await ensureReferenceData(db)
  console.log('Reference data ensured.')
  if (process.argv.includes('--demo')) {
    const n = await seedDemoData(db)
    console.log(`Inserted ${n} demo deals (fictional, labelled DEMO).`)
  }
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
