/** Exchange-rate sources and money formatting, with fake responses (TEST FIXTURES). */
import { describe, expect, it } from 'vitest'
import { fetchUsdRate } from '@/lib/providers/exchange-rates'
import { costLabel, formatMoney, formatUsd, toUsd } from '@/lib/trips/money'
import { json, router } from '../place-fixtures'

const communityRates = () => json({ date: '2026-10-27', usd: { jpy: 152.4, crc: 512.75, mxn: 18.1 } })

describe('fetchUsdRate', () => {
  it('uses the European Central Bank rate when there is one', async () => {
    const calls: URL[] = []
    const f = router(
      {
        'api.frankfurter.dev': (u) => {
          expect(u.pathname).toBe('/v1/latest')
          expect(u.searchParams.get('base')).toBe('USD')
          return json({ amount: 1, base: 'USD', date: '2026-10-27', rates: { [u.searchParams.get('symbols')!]: 152.3 } })
        },
      },
      calls,
    )
    expect(await fetchUsdRate('JPY', f)).toEqual({ rate: { perUsd: 152.3, source: 'ecb', asOf: '2026-10-27' }, requests: 1 })
    expect(calls).toHaveLength(1)
  })

  it('falls back to the community rates for currencies the ECB does not publish', async () => {
    const f = router({ 'api.frankfurter.dev': () => json({ message: 'not found' }, 404), 'cdn.jsdelivr.net': communityRates })
    expect(await fetchUsdRate('CRC', f)).toEqual({ rate: { perUsd: 512.75, source: 'currency_api', asOf: '2026-10-27' }, requests: 2 })
  })

  it('tries the second community address, and gives up cleanly', async () => {
    const backup = router({ 'latest.currency-api.pages.dev': communityRates })
    expect((await fetchUsdRate('MXN', backup)).rate).toMatchObject({ perUsd: 18.1, source: 'currency_api' })
    expect((await fetchUsdRate('XPF', router({ 'cdn.jsdelivr.net': communityRates }))).rate).toBeNull()
    expect((await fetchUsdRate('JPY', router({}))).rate).toBeNull()
    expect(await fetchUsdRate('USD', router({}))).toEqual({ rate: null, requests: 0 })
  })
})

describe('money', () => {
  const rates = { JPY: { perUsd: 150, source: 'ecb' as const, asOf: '2026-10-27' } }
  it('shows local amounts with their symbol, and dollars rounded', () => {
    expect(formatMoney(12000, 'JPY')).toBe('¥12,000')
    expect(formatMoney(40, 'EUR')).toBe('€40')
    expect(formatMoney(12.5, 'USD')).toBe('$12.50')
    expect(formatMoney(12000, 'JPY', { code: true })).toMatch(/^JPY\s12,000$/)
    expect(formatMoney(11250, 'XPF')).toMatch(/^XPF\s11,250$/)
    expect(formatUsd(80)).toBe('$80')
    expect(formatUsd(4.567)).toBe('$4.57')
  })
  it('converts at the locked rate, and says when there is none', () => {
    expect(toUsd(12000, 'JPY', rates)).toBe(80)
    expect(toUsd(25, 'USD', {})).toBe(25)
    expect(toUsd(100, 'EUR', rates)).toBeNull()
    expect(costLabel(12000, 'JPY', rates)).toBe('¥12,000 · about $80')
    expect(costLabel(100, 'EUR', rates)).toBe('€100 · no rate yet')
    expect(costLabel(40, 'USD', rates)).toBe('$40')
  })
})
