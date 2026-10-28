import { itemMapsLink, osmEmbedUrl, type TripItemView } from '@/lib/trips/shared'
import { cx } from '../ui'

type MediaItem = Pick<TripItemView, 'photo' | 'lat' | 'lng' | 'mapSpan' | 'place' | 'title' | 'url'>

export function hasPlaceMedia(item: MediaItem): boolean {
  return !!item.photo || (item.lat != null && item.lng != null)
}

/** Small square photo for an item row. */
export function PlaceThumb({ item }: { item: MediaItem }) {
  if (!item.photo) return null
  return (
    // eslint-disable-next-line @next/next/no-img-element -- Wikimedia thumbnails; next/image would need the host allow-listed for no gain.
    <img src={item.photo.url} alt={`Photo of ${item.place ?? item.title}`} loading="lazy" className="size-14 shrink-0 rounded-lg object-cover" />
  )
}

/** The place's photo (with its credit) and an OpenStreetMap map with a pin. */
export function PlaceMediaPanel({ item, destination }: { item: MediaItem; destination?: string | null }) {
  const hasMap = item.lat != null && item.lng != null
  const mapsLink = itemMapsLink(item, destination)
  const label = item.place ?? item.title
  return (
    <div className={cx('mt-2 grid gap-2', item.photo && hasMap && 'sm:grid-cols-2')}>
      {item.photo && (
        <figure className="overflow-hidden rounded-lg border border-line bg-surface">
          {/* eslint-disable-next-line @next/next/no-img-element -- Wikimedia thumbnails; next/image would need the host allow-listed for no gain. */}
          <img src={item.photo.url} alt={`Photo of ${label}`} loading="lazy" className="aspect-[4/3] w-full object-cover" />
          <figcaption className="px-2 py-1 text-[11px] text-muted">
            Photo:{' '}
            <a href={item.photo.pageUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
              {item.photo.credit}
            </a>{' '}
            · {item.photo.license} · Wikimedia Commons
          </figcaption>
        </figure>
      )}
      {hasMap && (
        <div className="overflow-hidden rounded-lg border border-line bg-surface">
          <iframe src={osmEmbedUrl(item.lat!, item.lng!, item.mapSpan)} title={`Map of ${label}`} loading="lazy" className="aspect-[4/3] w-full" />
          <div className="flex flex-wrap justify-between gap-2 px-2 py-1 text-[11px] text-muted">
            <span>Map © OpenStreetMap contributors</span>
            {mapsLink && (
              <a href={mapsLink} target="_blank" rel="noopener noreferrer" className="text-primary">
                Open in Google Maps ↗
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
