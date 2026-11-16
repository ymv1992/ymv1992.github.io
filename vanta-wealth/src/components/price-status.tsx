import { dateTime } from '@/lib/format'

/** States where prices came from and when, so nothing reads as live when it is not. */
export function PriceStatus({ feeds, priced, total, finnhub, errors }: { feeds: Map<string, { fetchedAt: Date; error: string | null }>; priced: number; total: number; finnhub: boolean; errors: string[] }) {
  const stocks = feeds.get('quotes:stocks')
  const crypto = feeds.get('quotes:crypto')
  return (
    <div className="text-xs text-faint">
      <p>
        <span className="num">{priced}</span> of <span className="num">{total}</span> holdings priced.
        {finnhub ? stocks ? ` Stocks: Finnhub, fetched ${dateTime(stocks.fetchedAt)}.` : ' Stocks: Finnhub, not fetched yet.' : ' Stocks: no price source connected.'}
        {crypto ? ` Crypto: CoinGecko, fetched ${dateTime(crypto.fetchedAt)}.` : ''} Prices can be delayed; each one shows its own timestamp on the Portfolio page.
      </p>
      {errors.map((e) => (
        <p key={e} className="mt-1 text-warn">
          Price source problem: {e} Showing the last prices received.
        </p>
      ))}
    </div>
  )
}
