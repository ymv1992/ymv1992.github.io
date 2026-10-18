'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useActionState, useState, useTransition } from 'react'
import { createCollectionAction, deleteCollectionAction, renameCollectionAction, type FormState } from '@/app/actions/saved-actions'
import { Button, buttonClass, cx } from '../ui'
import { SavedItem, type SavedItemData } from './saved-item'

interface Collection {
  id: string
  name: string
  count: number
  isDefault: boolean
}

export function SavedBoard({ items, collections, active, archived, nowMs }: { items: SavedItemData[]; collections: Collection[]; active: string | null; archived: boolean; nowMs: number }) {
  const router = useRouter()
  const [compare, setCompare] = useState<string[]>([])
  const [state, createAction, creating] = useActionState<FormState, FormData>(createCollectionAction, { error: null })
  const [pending, start] = useTransition()
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const current = collections.find((c) => c.id === active)

  const visible = active ? items.filter((i) => i.collectionIds.includes(active)) : items
  const compareHref = `/saved/compare?ids=${compare.join(',')}`

  return (
    <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
      <aside aria-label="Collections" className="space-y-3">
        <nav className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
          <Link href="/saved" className={cx('rounded-xl px-3 py-2 text-sm whitespace-nowrap', !active && !archived ? 'bg-primary-soft font-semibold text-primary' : 'text-muted hover:bg-surface-2')}>
            All saved <span className="text-faint">({items.length})</span>
          </Link>
          {collections.map((c) => (
            <Link
              key={c.id}
              href={`/saved?collection=${c.id}`}
              className={cx('rounded-xl px-3 py-2 text-sm whitespace-nowrap', active === c.id ? 'bg-primary-soft font-semibold text-primary' : 'text-muted hover:bg-surface-2')}
            >
              {c.name} <span className="text-faint">({c.count})</span>
            </Link>
          ))}
          <Link href="/saved?archived=1" className={cx('rounded-xl px-3 py-2 text-sm whitespace-nowrap', archived ? 'bg-primary-soft font-semibold text-primary' : 'text-muted hover:bg-surface-2')}>
            Archived
          </Link>
        </nav>
        <form action={createAction} className="flex gap-2">
          <label htmlFor="new-collection" className="sr-only">
            New collection name
          </label>
          <input id="new-collection" name="name" maxLength={60} placeholder="New collection" className="field" required />
          <Button type="submit" size="sm" variant="secondary" disabled={creating} className="h-10">
            Add
          </Button>
        </form>
        {state.error && <p role="alert" className="text-xs text-danger">{state.error}</p>}
        {state.ok && <p role="status" className="text-xs text-ok">{state.ok}</p>}
      </aside>

      <div>
        {current && (
          <div className="mb-4 flex flex-wrap items-center gap-2">
            {editing === current.id ? (
              <>
                <label htmlFor="rename" className="sr-only">
                  Collection name
                </label>
                <input id="rename" className="field max-w-xs" value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={60} />
                <Button
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const res = await renameCollectionAction(current.id, draft)
                      if (res.error) setError(res.error)
                      else setEditing(null)
                    })
                  }
                >
                  Save
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                  Cancel
                </Button>
              </>
            ) : (
              <>
                <h2 className="font-display mr-2 text-2xl">{current.name}</h2>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setDraft(current.name)
                    setEditing(current.id)
                  }}
                >
                  Rename
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-danger"
                  disabled={pending}
                  onClick={() => {
                    if (window.confirm(`Delete the collection “${current.name}”? Saved deals stay saved.`)) {
                      start(async () => {
                        await deleteCollectionAction(current.id)
                        router.push('/saved')
                      })
                    }
                  }}
                >
                  Delete collection
                </Button>
              </>
            )}
            {error && <p role="alert" className="w-full text-xs text-danger">{error}</p>}
          </div>
        )}

        {compare.length > 0 && (
          <div className="sticky top-16 z-20 mb-4 flex items-center justify-between rounded-2xl border border-primary bg-primary-soft px-4 py-2 text-sm">
            <span>
              {compare.length} selected (up to 4)
            </span>
            <span className="flex gap-2">
              <button type="button" className="text-muted underline-offset-2 hover:underline" onClick={() => setCompare([])}>
                Clear
              </button>
              <Link href={compareHref} className={buttonClass('primary', 'sm')} aria-disabled={compare.length < 2}>
                Compare side by side
              </Link>
            </span>
          </div>
        )}

        {visible.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-line px-6 py-12 text-center text-sm text-muted">
            {archived ? 'No archived saved deals.' : active ? 'Nothing in this collection yet. Open a saved deal’s “Notes, collections & alerts” to add it.' : 'Nothing saved yet. Swipe right in Discover or tap Save on any deal.'}
          </div>
        ) : (
          <ul className="space-y-3">
            {visible.map((item) => (
              <SavedItem
                key={item.savedId}
                item={item}
                collections={collections}
                nowMs={nowMs}
                compareSelected={compare.includes(item.card.id)}
                onToggleCompare={() => setCompare((c) => (c.includes(item.card.id) ? c.filter((x) => x !== item.card.id) : [...c, item.card.id].slice(0, 4)))}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
