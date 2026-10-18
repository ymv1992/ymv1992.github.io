import 'server-only'

/**
 * Server-only configuration. Secrets are read here and never passed to client
 * components; pages receive only booleans describing what is configured.
 */
export const config = {
  appUrl: () => (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, ''),
  ownerEmail: () => process.env.OWNER_EMAIL?.trim().toLowerCase() ?? null,
  ownerPasswordHash: () => process.env.OWNER_PASSWORD_HASH?.trim() ?? null,
  cronSecret: () => process.env.CRON_SECRET ?? null,
  seatsAeroKey: () => process.env.SEATS_AERO_API_KEY ?? null,
  serpApiKey: () => process.env.SERPAPI_API_KEY ?? null,
  resendKey: () => process.env.RESEND_API_KEY ?? null,
  emailFrom: () => process.env.EMAIL_FROM ?? null,
  anthropicKey: () => process.env.ANTHROPIC_API_KEY ?? null,
  anthropicModel: () => process.env.ANTHROPIC_MODEL ?? 'claude-haiku-5-5',
  unsplashKey: () => process.env.UNSPLASH_ACCESS_KEY ?? null,
  rssFeeds: () =>
    (process.env.RSS_FEEDS ?? '')
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter((s) => /^https:\/\//.test(s)),
}

export interface IntegrationStatus {
  auth: boolean
  database: 'postgres' | 'pglite'
  seatsAero: boolean
  serpApi: boolean
  email: boolean
  ai: boolean
  unsplash: boolean
  rss: boolean
  cron: boolean
}

export function integrationStatus(): IntegrationStatus {
  return {
    auth: !!(config.ownerEmail() && config.ownerPasswordHash()),
    database: process.env.DATABASE_URL ? 'postgres' : 'pglite',
    seatsAero: !!config.seatsAeroKey(),
    serpApi: !!config.serpApiKey(),
    email: !!(config.resendKey() && config.emailFrom()),
    ai: !!config.anthropicKey(),
    unsplash: !!config.unsplashKey(),
    rss: config.rssFeeds().length > 0,
    cron: !!config.cronSecret(),
  }
}
