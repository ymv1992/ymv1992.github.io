import { CHASE_TRAVEL_PROGRAM_ID } from '../domain/constants'
import type { TransferPartner } from '../domain/types'

/** Options for "Book with": active transfer partners plus Chase Travel. */
export function programOptions(partners: Iterable<TransferPartner>): { id: string; label: string }[] {
  const list = [...partners]
    .filter((p) => p.active)
    .sort((a, b) => a.type.localeCompare(b.type) || a.programName.localeCompare(b.programName))
    .map((p) => ({ id: p.id, label: `${p.programName} (${p.name})` }))
  return [...list, { id: CHASE_TRAVEL_PROGRAM_ID, label: 'Chase Travel (pay with points)' }]
}
