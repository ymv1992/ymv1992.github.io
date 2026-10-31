import { CABINS, type Cabin } from '../domain/constants'

/** Reads ?key= (a route or hotel) and ?cabin=; older links put the cabin at the end of the route key. */
export function parseCalendarSelection(sp: { key?: string; cabin?: string }): { key: string | undefined; cabin: Cabin | undefined } {
  const isCabin = (c: string | undefined): c is Cabin => !!c && (CABINS as readonly string[]).includes(c)
  const m = sp.key?.match(/^(f:[A-Z]{3}:[A-Z]{3}):([a-z_]+)$/)
  if (m) return { key: m[1], cabin: isCabin(sp.cabin) ? sp.cabin : isCabin(m[2]) ? m[2] : undefined }
  return { key: sp.key, cabin: isCabin(sp.cabin) ? sp.cabin : undefined }
}
