import type { TransferPartner, TransferPromotion } from '../domain/types'

/** Serializable shapes for passing partner data to client components. */
export type PartnerDTO = Omit<TransferPartner, 'lastVerifiedAt'> & { lastVerifiedAt: string | null; typicalValueCents: number | null }
export type PromotionDTO = Omit<TransferPromotion, 'startsAt' | 'endsAt' | 'lastVerifiedAt'> & { startsAt: string; endsAt: string | null; lastVerifiedAt: string | null }

export function toPartnerDTO(p: TransferPartner & { typicalValueCents?: number | null }): PartnerDTO {
  return { ...p, lastVerifiedAt: p.lastVerifiedAt?.toISOString() ?? null, typicalValueCents: p.typicalValueCents ?? null }
}

export function toPromotionDTO(p: TransferPromotion): PromotionDTO {
  return { ...p, startsAt: p.startsAt.toISOString(), endsAt: p.endsAt?.toISOString() ?? null, lastVerifiedAt: p.lastVerifiedAt?.toISOString() ?? null }
}

export function fromPartnerDTO(p: PartnerDTO): TransferPartner {
  return { ...p, lastVerifiedAt: p.lastVerifiedAt ? new Date(p.lastVerifiedAt) : null }
}

export function fromPromotionDTO(p: PromotionDTO): TransferPromotion {
  return {
    ...p,
    startsAt: new Date(p.startsAt),
    endsAt: p.endsAt ? new Date(p.endsAt) : null,
    lastVerifiedAt: p.lastVerifiedAt ? new Date(p.lastVerifiedAt) : null,
  }
}
