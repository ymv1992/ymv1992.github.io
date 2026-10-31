'use client'

import { useRouter } from 'next/navigation'
import { useRef, useState, useTransition } from 'react'
import { likeIdeaAction, skipIdeaAction, unskipIdeasAction } from '@/app/actions/idea-actions'
import type { GuideCard } from '@/lib/data/ideas'
import { Button } from '../ui'

const TYPE_LABEL: Record<string, string> = { see: 'See', do: 'Do', eat: 'Eat', drink: 'Drink', buy: 'Shop' }
const SWIPE_PX = 90

/**
 * One idea at a time, like a feed: swipe right (or tap the heart) to add it
 * to the trip's Ideas, left to skip. Skipped ideas can be brought back.
 */
export function IdeaDeck({
  tripId,
  tripName,
  city,
  countryCode,
  cards,
  remaining,
  skipped,
}: {
  tripId: string
  tripName: string
  city: string
  countryCode: string | null
  cards: GuideCard[]
  remaining: number
  skipped: number
}) {
  const router = useRouter()
  const [index, setIndex] = useState(0)
  const [dx, setDx] = useState(0)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [liked, setLiked] = useState(0)
  const [skippedNow, setSkippedNow] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [pending, start] = useTransition()
  const startX = useRef<number | null>(null)
  const card = cards[index]

  const decide = (like: boolean) => {
    if (!card) return
    setIndex((i) => i + 1)
    setDx(0)
    start(async () => {
      try {
        if (like) {
          const r = await likeIdeaAction(tripId, city, countryCode, card.key)
          setMessage({ ok: r.ok, text: r.message })
          if (r.ok) setLiked((n) => n + 1)
        } else {
          await skipIdeaAction(tripId, city, card.key)
          setSkippedNow((n) => n + 1)
        }
      } catch {
        setMessage({ ok: false, text: 'Could not reach the site. That one wasn’t saved.' })
      }
    })
  }

  if (!card) {
    return (
      <div className="rounded-2xl border border-dashed border-line px-4 py-8 text-center text-sm text-muted">
        <p>{remaining > cards.length ? 'Reload the page for more ideas.' : `That’s every idea for ${city} for now.`}</p>
        {liked > 0 && <p className="mt-1">You added {liked} to {tripName}&rsquo;s Ideas.</p>}
        {skipped + skippedNow > 0 && (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="mt-3"
            disabled={pending}
            onClick={() =>
              start(async () => {
                await unskipIdeasAction(tripId)
                setIndex(0)
                setSkippedNow(0)
                router.refresh()
              })
            }
          >
            Show the ones I skipped
          </Button>
        )}
      </div>
    )
  }

  const tilt = Math.max(-12, Math.min(12, dx / 12))
  return (
    <div>
      <article
        aria-roledescription="idea card"
        aria-label={`${TYPE_LABEL[card.type] ?? ''}: ${card.name}`}
        className="relative touch-pan-y overflow-hidden rounded-2xl border border-line bg-surface shadow-sm select-none"
        style={{ transform: `translateX(${dx}px) rotate(${tilt}deg)`, transition: dragging ? 'none' : 'transform 150ms ease-out' }}
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest('a,button')) return
          startX.current = e.clientX
          setDragging(true)
          e.currentTarget.setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => {
          if (startX.current != null) setDx(e.clientX - startX.current)
        }}
        onPointerUp={() => {
          const moved = dx
          startX.current = null
          setDragging(false)
          if (moved > SWIPE_PX) decide(true)
          else if (moved < -SWIPE_PX) decide(false)
          else setDx(0)
        }}
        onPointerCancel={() => {
          startX.current = null
          setDragging(false)
          setDx(0)
        }}
      >
        {dx > 30 && <span className="absolute top-4 left-4 z-10 rounded-lg border-2 border-ok bg-surface/90 px-2 py-1 text-sm font-bold text-ok">ADD</span>}
        {dx < -30 && <span className="absolute top-4 right-4 z-10 rounded-lg border-2 border-danger bg-surface/90 px-2 py-1 text-sm font-bold text-danger">SKIP</span>}
        {card.photo ? (
          <figure className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element -- Wikimedia thumbnails; next/image would need the host allow-listed for no gain. */}
            <img src={card.photo.url} alt={`Photo of ${card.name}`} draggable={false} className="aspect-[4/3] w-full object-cover" />
            <figcaption className="absolute right-0 bottom-0 left-0 bg-gradient-to-t from-black/60 to-transparent px-3 pt-6 pb-1.5 text-[10px] text-white/90">
              <a href={card.photo.pageUrl} target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:underline">
                Photo: {card.photo.credit} · {card.photo.license}
              </a>
            </figcaption>
          </figure>
        ) : (
          <div className="flex aspect-[4/3] w-full items-center justify-center bg-primary-soft/40 px-6 text-center font-display text-2xl text-primary">{card.name}</div>
        )}
        <div className="p-4">
          <p className="text-xs font-semibold tracking-wide text-gold uppercase">
            {TYPE_LABEL[card.type]} · {city}
          </p>
          <h3 className="mt-0.5 font-display text-xl">{card.name}</h3>
          {card.alt && <p className="text-sm text-muted">{card.alt}</p>}
          {card.content && <p className="mt-2 line-clamp-6 text-sm">{card.content}</p>}
          <dl className="mt-2 space-y-0.5 text-xs text-muted">
            {card.address && (
              <div>
                <dt className="sr-only">Address</dt>
                <dd>{card.address}</dd>
              </div>
            )}
            {card.hours && (
              <div>
                <dt className="inline">Hours: </dt>
                <dd className="inline">{card.hours}</dd>
              </div>
            )}
            {card.price && (
              <div>
                <dt className="inline">Price: </dt>
                <dd className="inline">{card.price}</dd>
              </div>
            )}
          </dl>
          {card.url && (
            <a href={card.url} target="_blank" rel="noopener noreferrer nofollow" className="mt-2 inline-block text-xs text-primary hover:underline">
              Official site ↗
            </a>
          )}
        </div>
      </article>
      <div className="mt-4 flex items-center justify-center gap-6">
        <button
          type="button"
          onClick={() => decide(false)}
          aria-label={`Skip ${card.name}`}
          className="flex size-14 items-center justify-center rounded-full border border-line bg-surface text-2xl text-danger shadow-sm hover:bg-danger-soft"
        >
          ✕
        </button>
        <span className="text-xs text-muted tabular">
          {index + 1} of {Math.max(cards.length, remaining)}
        </span>
        <button
          type="button"
          onClick={() => decide(true)}
          aria-label={`Add ${card.name} to ${tripName}’s Ideas`}
          className="flex size-14 items-center justify-center rounded-full bg-primary text-2xl text-primary-ink shadow-sm hover:opacity-90"
        >
          ♥
        </button>
      </div>
      <p className="mt-2 text-center text-xs text-muted">Swipe right or tap ♥ to add it to {tripName}&rsquo;s Ideas; swipe left or tap ✕ to skip.</p>
      {message && (
        <p role={message.ok ? 'status' : 'alert'} className={`mt-2 text-center text-sm ${message.ok ? 'text-ok' : 'text-danger'}`}>
          {message.text}
        </p>
      )}
    </div>
  )
}
