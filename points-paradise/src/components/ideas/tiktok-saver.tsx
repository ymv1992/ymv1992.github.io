'use client'

import Link from 'next/link'
import { useActionState, useState, useTransition } from 'react'
import { addTikTokAction, dismissTikTokAction, saveTikTokAction, type TikTokFormState } from '@/app/actions/idea-actions'
import { Button } from '../ui'

export interface SavedTikTok {
  id: string
  status: 'new' | 'liked' | 'skipped'
  title: string
  found: boolean
  caption: string | null
  author: string | null
  authorUrl: string | null
  url: string | null
  videoId: string | null
  candidates: string[]
}

function playerUrl(videoId: string): string {
  return `https://www.tiktok.com/player/v1/${videoId}?description=1&music_info=0`
}

function TikTokCard({ tripId, t }: { tripId: string; t: SavedTikTok }) {
  const [watch, setWatch] = useState(false)
  const [place, setPlace] = useState(t.found ? t.title : (t.candidates[0] ?? ''))
  const [pending, start] = useTransition()
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const done = t.status === 'liked' || message?.ok
  return (
    <li className="rounded-xl border border-line bg-surface p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted">
            TikTok
            {t.author && (
              <>
                {' '}
                by{' '}
                {t.authorUrl ? (
                  <a href={t.authorUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                    @{t.author}
                  </a>
                ) : (
                  `@${t.author}`
                )}
              </>
            )}
          </p>
          {t.caption && <p className="mt-1 line-clamp-3 text-sm whitespace-pre-line">{t.caption}</p>}
        </div>
        {t.videoId && (
          <button type="button" onClick={() => setWatch((v) => !v)} aria-expanded={watch} className="shrink-0 rounded-full border border-line px-3 py-1 text-xs text-primary hover:bg-surface-2">
            {watch ? 'Hide video' : '▶ Watch'}
          </button>
        )}
      </div>
      {watch && t.videoId && (
        <iframe
          src={playerUrl(t.videoId)}
          title={`TikTok video${t.author ? ` by @${t.author}` : ''}`}
          className="mx-auto mt-3 aspect-[9/16] w-full max-w-xs rounded-xl border border-line"
          allow="encrypted-media; fullscreen; picture-in-picture"
          referrerPolicy="strict-origin-when-cross-origin"
        />
      )}
      {done ? (
        <p className="mt-2 text-sm text-ok">
          Added to your trip&rsquo;s Ideas.{' '}
          <Link href={`/trips/${tripId}`} className="text-primary hover:underline">
            Open the trip
          </Link>
        </p>
      ) : (
        <div className="mt-3">
          <label htmlFor={`tt-${t.id}`} className="label">
            {t.found ? 'Looks like this place — fix it if it’s wrong' : 'Where is this? (the caption doesn’t say)'}
          </label>
          <input id={`tt-${t.id}`} value={place} onChange={(e) => setPlace(e.target.value)} maxLength={200} placeholder="e.g. Pastéis de Belém, Lisbon" className="field" list={`tt-c-${t.id}`} />
          {t.candidates.length > 1 && (
            <datalist id={`tt-c-${t.id}`}>
              {t.candidates.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              disabled={pending || !place.trim()}
              onClick={() =>
                start(async () => {
                  try {
                    const r = await addTikTokAction(tripId, t.id, place)
                    setMessage({ ok: r.ok, text: r.message })
                  } catch {
                    setMessage({ ok: false, text: 'Could not reach the site. Try again.' })
                  }
                })
              }
            >
              {pending ? 'Adding…' : 'Add to Ideas'}
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => start(() => dismissTikTokAction(tripId, t.id))}>
              Not for this trip
            </Button>
            {message && !message.ok && (
              <span role="alert" className="text-xs text-danger">
                {message.text}
              </span>
            )}
          </div>
        </div>
      )}
    </li>
  )
}

/** Paste (or share) a TikTok link; its place is suggested from the caption and added once you confirm. */
export function TikTokSaver({ tripId, tripName, shared, saved }: { tripId: string; tripName: string; shared: string; saved: SavedTikTok[] }) {
  const [state, action, pending] = useActionState<TikTokFormState, FormData>(saveTikTokAction, { error: null })
  const open = saved.filter((t) => t.status !== 'skipped')
  return (
    <div>
      <form key={state.attempt ?? 0} action={action} className="flex flex-col gap-2 sm:flex-row">
        <input type="hidden" name="tripId" value={tripId} />
        <label htmlFor="tt-link" className="sr-only">
          TikTok link
        </label>
        <input id="tt-link" name="link" defaultValue={state.ok ? '' : shared} required placeholder="Paste a TikTok link" className="field min-w-0 flex-1" inputMode="url" />
        <Button type="submit" disabled={pending}>
          {pending ? 'Reading…' : `Save to ${tripName}`}
        </Button>
      </form>
      <p className="mt-1 text-xs text-muted">In TikTok, tap Share → Copy link, then paste it here. The site reads the video&rsquo;s caption to find the place, and nothing is added until you confirm.</p>
      {(state.error || state.ok) && (
        <p role={state.error ? 'alert' : 'status'} className={`mt-2 text-sm ${state.error ? 'text-danger' : 'text-ok'}`}>
          {state.error ?? state.ok}
        </p>
      )}
      {open.length > 0 && (
        <ul className="mt-4 space-y-3" aria-label="Saved TikToks">
          {open.map((t) => (
            <TikTokCard key={t.id} tripId={tripId} t={t} />
          ))}
        </ul>
      )}
    </div>
  )
}
