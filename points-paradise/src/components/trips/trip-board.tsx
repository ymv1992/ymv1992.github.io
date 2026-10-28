'use client'

import Link from 'next/link'
import { useCallback, useMemo, useRef, useState, useTransition } from 'react'
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
  pointerWithin,
  rectIntersection,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { arrangeTripAction, deleteTripItemAction, setTripItemDoneAction } from '@/app/actions/trip-actions'
import { isGoogleMapsLink } from '@/lib/places/google-maps-link'
import { TRIP_KIND_LABEL, dayHeading, itemMapsLink, type TripDayView, type TripItemView } from '@/lib/trips/shared'
import { Icon } from '../icons'
import { cx } from '../ui'
import { hasPlaceMedia, PlaceMediaPanel, PlaceThumb } from './place-media'
import { TripItemForm } from './trip-item-form'

const IDEAS = 'ideas'
type Columns = Record<string, string[]>

const columnId = (day: number | null) => (day == null ? IDEAS : `day-${day}`)
const columnDay = (id: string) => (id === IDEAS ? null : Number(id.slice(4)))

function buildColumns(days: TripDayView[], items: TripItemView[]): Columns {
  const cols: Columns = { [IDEAS]: [] }
  for (const d of days) cols[columnId(d.day)] = []
  for (const i of [...items].sort((a, b) => a.position - b.position)) (cols[columnId(i.day)] ?? cols[IDEAS]!).push(i.id)
  return cols
}

function money(n: number) {
  return `$${n.toLocaleString('en-US', { maximumFractionDigits: n < 100 ? 2 : 0 })}`
}

/**
 * The itinerary: one column per day plus an ideas list. Items can be dragged
 * by their handle (press and hold on phones) to another place or day, ticked
 * off, edited or removed. Changes save straight away.
 */
export function TripBoard({ tripId, destination, days, items }: { tripId: string; destination: string; days: TripDayView[]; items: TripItemView[] }) {
  const [columns, setColumns] = useState<Columns>(() => buildColumns(days, items))
  const [done, setDone] = useState<Record<string, boolean>>(() => Object.fromEntries(items.map((i) => [i.id, i.done])))
  const [removed, setRemoved] = useState<Set<string>>(new Set())
  const [activeId, setActiveId] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [adding, setAdding] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [, startTransition] = useTransition()
  const before = useRef<Columns | null>(null)
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  // Whatever is under the pointer wins; over a day's list, snap to its nearest item so reordering within a day works.
  const collision: CollisionDetection = useCallback(
    (args) => {
      const hits = pointerWithin(args)
      const first = (hits.length ? hits : rectIntersection(args))[0]?.id
      if (first == null) return []
      const inColumn = columns[String(first)]
      if (inColumn?.length) {
        const nearest = closestCenter({ ...args, droppableContainers: args.droppableContainers.filter((c) => inColumn.includes(String(c.id))) })
        if (nearest.length) return nearest
      }
      return [{ id: first }]
    },
    [columns],
  )

  const findColumn = (id: string): string | undefined => (id in columns ? id : Object.keys(columns).find((c) => columns[c]!.includes(id)))

  const save = (next: Columns) => {
    const prev = before.current
    before.current = null
    if (!prev || JSON.stringify(prev) === JSON.stringify(next)) return
    const layout = Object.entries(next).map(([col, ids]) => ({ day: columnDay(col), ids: ids.filter((id) => !removed.has(id)) }))
    startTransition(async () => {
      try {
        const r = await arrangeTripAction(tripId, layout)
        if (!r.ok) {
          setError(r.error ?? 'Could not save the new order')
          setColumns(prev)
        } else setError(null)
      } catch {
        setError('Could not reach the site. The new order was not saved.')
        setColumns(prev)
      }
    })
  }

  const onDragStart = (e: DragStartEvent) => {
    before.current = columns
    setActiveId(String(e.active.id))
    setEditing(null)
  }

  // Moving over another column moves the item there right away, so the drop position is visible.
  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (!over) return
    const from = findColumn(String(active.id))
    const to = findColumn(String(over.id))
    if (!from || !to || from === to) return
    setColumns((prev) => {
      const target = prev[to]!.filter((id) => id !== active.id)
      const overIndex = target.indexOf(String(over.id))
      target.splice(overIndex >= 0 ? overIndex : target.length, 0, String(active.id))
      return { ...prev, [from]: prev[from]!.filter((id) => id !== active.id), [to]: target }
    })
  }

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setActiveId(null)
    let next = columns
    const col = findColumn(String(active.id))
    if (over && col && findColumn(String(over.id)) === col) {
      const list = columns[col]!
      const from = list.indexOf(String(active.id))
      const to = over.id === col ? list.length - 1 : list.indexOf(String(over.id))
      if (from >= 0 && to >= 0 && from !== to) next = { ...columns, [col]: arrayMove(list, from, to) }
    }
    setColumns(next)
    save(next)
  }

  const onDragCancel = () => {
    setActiveId(null)
    if (before.current) setColumns(before.current)
    before.current = null
  }

  const toggleDone = (id: string, value: boolean) => {
    setDone((d) => ({ ...d, [id]: value }))
    startTransition(async () => {
      try {
        await setTripItemDoneAction(tripId, id, value)
      } catch {
        setDone((d) => ({ ...d, [id]: !value }))
        setError('Could not reach the site. That tick was not saved.')
      }
    })
  }

  const remove = (item: TripItemView) => {
    if (!window.confirm(`Remove "${item.title}" from this trip?`)) return
    setRemoved((r) => new Set(r).add(item.id))
    startTransition(async () => {
      try {
        await deleteTripItemAction(tripId, item.id)
      } catch {
        setRemoved((r) => {
          const n = new Set(r)
          n.delete(item.id)
          return n
        })
        setError('Could not reach the site. Nothing was removed.')
      }
    })
  }

  const sections: { col: string; title: string; hint?: string; day: number | null }[] = [
    ...days.map((d) => ({ col: columnId(d.day), title: dayHeading(d), day: d.day })),
    { col: IDEAS, title: 'Ideas', hint: 'Things you might do. Drag them onto a day when you decide.', day: null },
  ]
  const active = activeId ? byId.get(activeId) : null
  const total = items.length - removed.size

  return (
    <div>
      {error && (
        <p role="alert" className="mb-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      {total > 1 && <p className="mb-3 text-xs text-muted">Tip: grab the dotted handle to move things around (press and hold on a phone).</p>}
      <DndContext id={`trip-board-${tripId}`} sensors={sensors} collisionDetection={collision} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd} onDragCancel={onDragCancel}>
        <div className="space-y-5">
          {sections.map((s) => {
            const ids = columns[s.col]!.filter((id) => !removed.has(id))
            return (
              <section key={s.col} aria-labelledby={`${s.col}-h`} className="rounded-2xl border border-line bg-surface p-3 sm:p-4">
                <div className="mb-2 flex items-baseline justify-between gap-3">
                  <h2 id={`${s.col}-h`} className="font-display text-lg">
                    {s.title}
                  </h2>
                  <span className="text-xs text-muted">
                    {ids.filter((id) => done[id]).length}/{ids.length} done
                  </span>
                </div>
                {s.hint && <p className="mb-2 text-xs text-muted">{s.hint}</p>}
                <Column id={s.col} ids={ids}>
                  {ids.map((id) => {
                    const item = byId.get(id)
                    if (!item) return null
                    return editing === id ? (
                      <li key={id}>
                        <TripItemForm tripId={tripId} days={days} item={item} onCancel={() => setEditing(null)} />
                      </li>
                    ) : (
                      <SortableItem key={id} item={item} done={!!done[id]} destination={destination} onToggle={(v) => toggleDone(id, v)} onEdit={() => setEditing(id)} onRemove={() => remove(item)} />
                    )
                  })}
                </Column>
                {adding === s.col ? (
                  <div className="mt-2">
                    <TripItemForm tripId={tripId} days={days} day={s.day} onCancel={() => setAdding(null)} />
                  </div>
                ) : (
                  <button type="button" onClick={() => setAdding(s.col)} className="mt-2 inline-flex items-center gap-1 rounded-full px-2 py-1 text-sm text-primary hover:bg-surface-2">
                    <Icon name="plus" className="size-4" /> Add {s.day == null ? 'an idea' : 'to this day'}
                  </button>
                )}
              </section>
            )
          })}
        </div>
        <DragOverlay>{active ? <ItemCard item={active} done={!!done[active.id]} destination={destination} overlay /> : null}</DragOverlay>
      </DndContext>
    </div>
  )
}

function Column({ id, ids, children }: { id: string; ids: string[]; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id })
  return (
    <SortableContext id={id} items={ids} strategy={verticalListSortingStrategy}>
      <ul ref={setNodeRef} className={cx('min-h-12 space-y-2 rounded-xl transition-colors', isOver && 'bg-primary-soft/40')}>
        {children}
        {ids.length === 0 && <li className="rounded-xl border border-dashed border-line px-3 py-3 text-center text-xs text-muted">Nothing here yet. Add something, or drag it here.</li>}
      </ul>
    </SortableContext>
  )
}

function SortableItem(props: { item: TripItemView; done: boolean; destination: string; onToggle: (v: boolean) => void; onEdit: () => void; onRemove: () => void }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: props.item.id })
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cx(isDragging && 'opacity-40')}>
      <ItemCard
        {...props}
        handle={
          <button
            type="button"
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            aria-label={`Move ${props.item.title}`}
            className="-ml-1 cursor-grab touch-none rounded-md p-1 text-faint hover:bg-surface-2 hover:text-ink active:cursor-grabbing"
          >
            <Icon name="grip" strokeWidth={3} />
          </button>
        }
      />
    </li>
  )
}

function ItemCard({
  item,
  done,
  destination,
  handle,
  overlay,
  onToggle,
  onEdit,
  onRemove,
}: {
  item: TripItemView
  done: boolean
  destination: string
  handle?: React.ReactNode
  overlay?: boolean
  onToggle?: (v: boolean) => void
  onEdit?: () => void
  onRemove?: () => void
}) {
  const [showMedia, setShowMedia] = useState(false)
  const mapsLink = itemMapsLink(item, destination)
  const media = hasPlaceMedia(item) && !overlay
  const meta = [TRIP_KIND_LABEL[item.kind], item.points ? `${item.points.toLocaleString('en-US')} pts` : null, item.costUsd ? money(item.costUsd) : null].filter(Boolean)
  return (
    <div className={cx('rounded-xl border border-line bg-bg p-2.5', overlay && 'shadow-lg ring-2 ring-primary/40')}>
      <div className="flex items-start gap-2">
        {handle ?? (
          <span className="-ml-1 p-1 text-faint">
            <Icon name="grip" strokeWidth={3} />
          </span>
        )}
        <input type="checkbox" checked={done} onChange={(e) => onToggle?.(e.target.checked)} aria-label={`Done: ${item.title}`} className="mt-1 size-5 shrink-0 accent-[var(--primary)]" />
        <div className="min-w-0 flex-1">
          <p className={cx('text-sm', done && 'text-muted line-through')}>
            {item.time && <span className="tabular mr-1.5 text-muted">{item.time}</span>}
            <span className="font-semibold">{item.title}</span>
          </p>
          <p className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-muted">
            <span>{meta.join(' · ')}</span>
            {item.place && mapsLink && (
              <a href={mapsLink} target="_blank" rel="noopener noreferrer" className="text-primary underline-offset-2 hover:underline">
                {item.place} ↗
              </a>
            )}
            {media && (
              <button type="button" onClick={() => setShowMedia((v) => !v)} aria-expanded={showMedia} className="text-primary underline-offset-2 hover:underline">
                {showMedia ? 'Hide' : item.photo ? 'Photo & map' : 'Map'}
              </button>
            )}
            {item.url && !(item.place && isGoogleMapsLink(item.url)) && (
              <a href={item.url} target="_blank" rel="noopener noreferrer nofollow" className="text-primary underline-offset-2 hover:underline">
                Link ↗
              </a>
            )}
            {item.dealId && (
              <Link href={`/deals/${item.dealId}`} className="text-primary underline-offset-2 hover:underline">
                View deal
              </Link>
            )}
          </p>
          {item.notes && <p className="mt-1 text-xs whitespace-pre-line">{item.notes}</p>}
        </div>
        {item.photo && (
          <button type="button" onClick={() => setShowMedia((v) => !v)} aria-label={`${showMedia ? 'Hide' : 'Show'} photo and map of ${item.place ?? item.title}`} className="shrink-0">
            <PlaceThumb item={item} />
          </button>
        )}
        {!overlay && (
          <div className="flex shrink-0 gap-0.5">
            <button type="button" onClick={onEdit} aria-label={`Edit ${item.title}`} className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-ink">
              <Icon name="pencil" className="size-4" />
            </button>
            <button type="button" onClick={onRemove} aria-label={`Remove ${item.title}`} className="rounded-md p-1.5 text-muted hover:bg-danger-soft hover:text-danger">
              <Icon name="trash" className="size-4" />
            </button>
          </div>
        )}
      </div>
      {media && showMedia && <PlaceMediaPanel item={item} destination={destination} />}
    </div>
  )
}
