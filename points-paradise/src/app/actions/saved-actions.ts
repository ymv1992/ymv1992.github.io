'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getDb } from '@/lib/db/client'
import { createCollection, deleteCollection, renameCollection } from '@/lib/data/saved'
import { requireUserId } from '@/lib/server/session'

export interface FormState {
  error: string | null
  ok?: string
}

const name = z.string().trim().min(1, 'Name is required').max(60)

export async function createCollectionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireUserId()
  const parsed = name.safeParse(formData.get('name'))
  if (!parsed.success) return { error: parsed.error.issues[0]!.message }
  try {
    await createCollection(await getDb(), userId, parsed.data)
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not create collection' }
  }
  revalidatePath('/saved')
  return { error: null, ok: `Created “${parsed.data}”` }
}

export async function renameCollectionAction(id: string, newName: string): Promise<FormState> {
  const userId = await requireUserId()
  const parsed = name.safeParse(newName)
  if (!z.string().uuid().safeParse(id).success || !parsed.success) return { error: 'Invalid name' }
  try {
    await renameCollection(await getDb(), userId, id, parsed.data)
  } catch {
    return { error: 'A collection with that name already exists' }
  }
  revalidatePath('/saved')
  return { error: null }
}

export async function deleteCollectionAction(id: string): Promise<FormState> {
  const userId = await requireUserId()
  if (!z.string().uuid().safeParse(id).success) return { error: 'Invalid collection' }
  await deleteCollection(await getDb(), userId, id)
  revalidatePath('/saved')
  return { error: null }
}
