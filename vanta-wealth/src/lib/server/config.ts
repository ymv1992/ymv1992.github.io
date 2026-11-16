import 'server-only'

/** Server-only configuration. Keys are read here and never sent to the browser. */
export const config = {
  ownerEmail: () => process.env.OWNER_EMAIL?.trim().toLowerCase() ?? null,
  ownerPasswordHash: () => process.env.OWNER_PASSWORD_HASH?.trim() ?? null,
  cronSecret: () => process.env.CRON_SECRET ?? null,
  finnhubKey: () => process.env.FINNHUB_API_KEY?.trim() || null,
  coingeckoKey: () => process.env.COINGECKO_API_KEY?.trim() || null,
}

export function integrationStatus() {
  return {
    auth: !!(config.ownerEmail() && config.ownerPasswordHash()),
    sessionSecret: (process.env.SESSION_SECRET ?? '').length >= 32,
    database: process.env.DATABASE_URL ? ('postgres' as const) : ('local' as const),
    finnhub: !!config.finnhubKey(),
    coingeckoKey: !!config.coingeckoKey(),
    cron: !!config.cronSecret(),
  }
}
