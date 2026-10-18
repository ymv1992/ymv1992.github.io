'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { DealCardData } from '@/lib/view/deal-view'
import { passDealAction, saveDealAction, undoFeedAction } from '@/app/actions/deal-actions'
import { Icon } from '../icons'
import { buttonClass, cx } from '../ui'
import { DealCard } from './deal-card'

interface HistoryEntry {
  id: string
  title: string
  action: 'save' | 'pass'
  feedbackId: string | null
}

const SWIPE_THRESHOLD = 110
const EXIT_MS = 240

export function SwipeDeck({ cards, nowMs }: { cards: DealCardData[]; nowMs: number }) {
  const router = useRouter()
  const [index, setIndex] = useState(0)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [drag, setDrag] = useState({ x: 0, y: 0, active: false })
  const [leaving, setLeaving] = useState<'left' | 'right' | null>(null)
  const [announce, setAnnounce] = useState('')
  const [error, setError] = useState<string | null>(null)
  const start = useRef<{ x: number; y: number; id: number } | null>(null)
  const deckRef = useRef<HTMLDivElement>(null)
  const busy = leaving !== null

  const current = cards[index]

  const commit = useCallback(
    (dir: 'left' | 'right') => {
      if (!current || busy) return
      const card = current
      const action: HistoryEntry['action'] = dir === 'right' ? 'save' : 'pass'
      setLeaving(dir)
      setError(null)
      const pending = action === 'save' ? saveDealAction(card.id, [], true) : passDealAction(card.id)
      // The card animates out immediately; if the server rejects the action we put it back.
      let advanced = false
      let failed = false
      setTimeout(() => {
        setLeaving(null)
        setDrag({ x: 0, y: 0, active: false })
        if (!failed) {
          advanced = true
          setIndex((i) => i + 1)
        }
      }, EXIT_MS)
      const restore = (message: string) => {
        failed = true
        setError(message)
        if (advanced) setIndex((i) => Math.max(0, i - 1))
      }
      pending
        .then((res) => {
          if (!res.ok) return restore(res.message ?? 'Something went wrong — the deal was not updated.')
          setHistory((h) => [...h, { id: card.id, title: card.title, action, feedbackId: res.feedbackId ?? null }])
          setAnnounce(`${action === 'save' ? 'Saved' : 'Passed'}: ${card.title}`)
        })
        .catch(() => restore('Network problem — the deal was not updated. Check your connection and try again.'))
    },
    [current, busy],
  )

  const undo = useCallback(async () => {
    const last = history[history.length - 1]
    if (!last || busy) return
    setHistory((h) => h.slice(0, -1))
    setIndex((i) => Math.max(0, i - 1))
    setAnnounce(`Undid ${last.action}: ${last.title}`)
    if (last.feedbackId) {
      const res = await undoFeedAction(last.feedbackId).catch(() => ({ ok: false, message: 'Network problem' }))
      if (!res.ok) setError(res.message ?? 'Could not undo on the server.')
    }
  }, [history, busy])

  const openDetails = useCallback(() => {
    if (current) router.push(`/deals/${current.id}`)
  }, [current, router])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = document.activeElement
      const inDeck = el === document.body || (el instanceof Node && !!deckRef.current?.contains(el))
      if (!inDeck || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        commit('right')
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        commit('left')
      } else if (e.key === 'Enter' && el === deckRef.current) {
        e.preventDefault()
        openDetails()
      } else if (e.key === 'z' || e.key === 'Backspace') {
        e.preventDefault()
        undo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [commit, undo, openDetails])

  function onPointerDown(e: React.PointerEvent) {
    if (busy) return
    start.current = { x: e.clientX, y: e.clientY, id: e.pointerId }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    setDrag({ x: 0, y: 0, active: true })
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!start.current || start.current.id !== e.pointerId) return
    setDrag({ x: e.clientX - start.current.x, y: e.clientY - start.current.y, active: true })
  }
  function onPointerUp(e: React.PointerEvent) {
    if (!start.current || start.current.id !== e.pointerId) return
    const dx = e.clientX - start.current.x
    const dy = e.clientY - start.current.y
    start.current = null
    if (Math.abs(dx) > SWIPE_THRESHOLD) commit(dx > 0 ? 'right' : 'left')
    else {
      setDrag({ x: 0, y: 0, active: false })
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) openDetails()
    }
  }

  if (!current) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-3xl border border-dashed border-line px-6 py-16 text-center">
        <p className="font-display text-2xl">You&apos;re all caught up</p>
        <p className="max-w-sm text-sm text-muted">
          No more deals in this view. Try another mode, recover deals you passed, or add one you found yourself.
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          {history.length > 0 && (
            <button type="button" onClick={undo} className={buttonClass('secondary')}>
              <Icon name="undo" className="size-4" /> Undo last
            </button>
          )}
          <Link href="/history?tab=passed" className={buttonClass('secondary')}>
            Passed deals
          </Link>
          <Link href="/deals/new" className={buttonClass('primary')}>
            Add a deal
          </Link>
        </div>
        <p className="sr-only" aria-live="polite">
          {announce}
        </p>
      </div>
    )
  }

  const x = leaving === 'right' ? 600 : leaving === 'left' ? -600 : drag.x
  const rotate = Math.max(-18, Math.min(18, x / 18))
  const saveOpacity = Math.max(0, Math.min(1, x / SWIPE_THRESHOLD))
  const passOpacity = Math.max(0, Math.min(1, -x / SWIPE_THRESHOLD))

  return (
    <div className="mx-auto w-full max-w-md">
      <div
        ref={deckRef}
        tabIndex={0}
        role="group"
        aria-roledescription="Deal cards"
        aria-label={`Deal ${index + 1} of ${cards.length}: ${current.title}. Right arrow saves, left arrow passes, Enter opens details.`}
        className="relative h-[min(640px,calc(100dvh-15rem))] min-h-[520px] focus-visible:outline-none"
      >
        {cards.slice(index + 1, index + 3).map((c, i) => (
          <div
            key={c.id}
            aria-hidden
            className="absolute inset-0 transition-transform duration-200"
            style={{ transform: `translateY(${(i + 1) * 10}px) scale(${1 - (i + 1) * 0.035})`, zIndex: 10 - i }}
          >
            <DealCard d={c} nowMs={nowMs} />
          </div>
        ))}
        <div
          key={current.id}
          className={cx('absolute inset-0 z-20 cursor-grab touch-pan-y active:cursor-grabbing', !drag.active && 'transition-transform duration-[240ms] ease-out')}
          style={{ transform: `translate(${x}px, ${leaving ? 40 : drag.y * 0.15}px) rotate(${rotate}deg)` }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => {
            start.current = null
            setDrag({ x: 0, y: 0, active: false })
          }}
        >
          <DealCard d={current} nowMs={nowMs} />
          <div aria-hidden className="pointer-events-none absolute top-24 left-6 -rotate-12 rounded-xl border-4 border-ok px-3 py-1 font-display text-3xl text-ok" style={{ opacity: saveOpacity }}>
            SAVE
          </div>
          <div aria-hidden className="pointer-events-none absolute top-24 right-6 rotate-12 rounded-xl border-4 border-danger px-3 py-1 font-display text-3xl text-danger" style={{ opacity: passOpacity }}>
            PASS
          </div>
        </div>
      </div>

      <div className="mt-5 flex items-center justify-center gap-3">
        <button type="button" onClick={() => commit('left')} disabled={busy} className="flex size-14 items-center justify-center rounded-full border border-line bg-surface text-danger shadow-card hover:bg-danger-soft" aria-label={`Pass on ${current.title}`}>
          <Icon name="x" className="size-6" />
        </button>
        <button type="button" onClick={undo} disabled={busy || history.length === 0} className="flex size-11 items-center justify-center rounded-full border border-line bg-surface text-muted shadow-card hover:bg-surface-2 disabled:opacity-40" aria-label="Undo last action">
          <Icon name="undo" className="size-5" />
        </button>
        <button type="button" onClick={openDetails} className="flex size-11 items-center justify-center rounded-full border border-line bg-surface text-primary shadow-card hover:bg-primary-soft" aria-label={`View details for ${current.title}`}>
          <Icon name="info" className="size-5" />
        </button>
        <button type="button" onClick={() => commit('right')} disabled={busy} className="flex size-14 items-center justify-center rounded-full bg-primary text-primary-ink shadow-card hover:opacity-90" aria-label={`Save ${current.title}`}>
          <Icon name="heart" className="size-6" />
        </button>
      </div>
      <p className="mt-3 text-center text-xs text-faint">
        {index + 1} of {cards.length} · Swipe or use ← → · Tap a card for the full analysis
      </p>
      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-center text-sm text-danger">
          {error}
        </p>
      )}
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
    </div>
  )
}
