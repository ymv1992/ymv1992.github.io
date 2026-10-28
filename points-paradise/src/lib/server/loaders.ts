import 'server-only'
import { cache } from 'react'
import { getDb } from '../db/client'
import { loadEvaluationData } from '../data/evaluation'
import { requireViewerId } from './session'

/** Owner + evaluated deals for the current request (deduplicated across components). */
export const getEvaluation = cache(async () => {
  const userId = await requireViewerId()
  const db = await getDb()
  const data = await loadEvaluationData(db, userId)
  return { userId, db, ...data }
})

export const getEvaluationWithArchive = cache(async () => {
  const userId = await requireViewerId()
  const db = await getDb()
  const data = await loadEvaluationData(db, userId, { includeArchived: true })
  return { userId, db, ...data }
})
