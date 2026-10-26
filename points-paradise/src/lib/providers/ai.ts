import 'server-only'
import { createHash } from 'node:crypto'
import Anthropic from '@anthropic-ai/sdk'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import type { AppDb } from '../db/client'
import { appState } from '../db/schema'
import { canSpend } from '../engine/budget'
import { logJob, monthSpendUsd } from '../data/usage'
import { config } from '../server/config'

/**
 * Optional language-model features. The model only ever writes prose from
 * facts the app computed deterministically; it is never asked for prices,
 * availability, ratios or calculations, and its output is labelled AI-written.
 */

const PROVIDER = 'anthropic'

/** USD per million tokens (input, output). Used for budget tracking only. */
const PRICES: Record<string, [number, number]> = {
  'claude-opus-5-5': [4, 20],
  'claude-sonnet-5-5': [2, 10],
  'claude-haiku-5-5': [0.1, 0.5],
}

/** Server-side fallback exists for Opus/Sonnet; Haiku has none, so the option is left off there. */
function fallbackOptions(model: string): { betas?: ['server-side-fallback-2026-07-01']; fallbacks?: 'default' } {
  return model.startsWith('claude-haiku') ? {} : { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }
}

function costUsd(model: string, input: number, output: number): number {
  const [i, o] = PRICES[model] ?? PRICES['claude-opus-5-5']!
  return (input * i + output * o) / 1_000_000
}

const SYSTEM = `You write short, precise travel notes for a private Chase Ultimate Rewards points app.
Rules you must follow:
- Use only the facts provided. Never state or estimate prices, points costs, taxes, availability, transfer ratios, award charts or dates that are not in the facts.
- If a fact is missing, say it is unknown rather than guessing.
- Keep the tone calm and practical. No hype, no emojis.`

export type AiResult<T> = { ok: true; value: T; cached: boolean } | { ok: false; reason: string }

interface CallOptions {
  db: AppDb
  monthlyBudgetUsd: number
  jobType: string
  cacheKey?: string
}

async function guard(opts: CallOptions, maxTokens: number, model: string): Promise<string | null> {
  if (!config.anthropicKey()) return 'AI is not configured (ANTHROPIC_API_KEY is not set).'
  const spent = await monthSpendUsd(opts.db, new Date(), PROVIDER)
  // Upper bound for this call: ~4k input tokens plus the full output allowance.
  const decision = canSpend(spent, costUsd(model, 4000, maxTokens), opts.monthlyBudgetUsd)
  if (!decision.allowed) {
    await logJob(opts.db, { provider: PROVIDER, jobType: opts.jobType, status: 'skipped_budget', startedAt: new Date(), error: decision.reason })
    return decision.reason
  }
  return null
}

async function readCache<T>(db: AppDb, key: string | undefined): Promise<T | null> {
  if (!key) return null
  const [row] = await db.select().from(appState).where(eq(appState.key, key))
  return row ? (row.value as { v: T }).v : null
}

async function writeCache(db: AppDb, key: string | undefined, value: unknown) {
  if (!key) return
  await db
    .insert(appState)
    .values({ key, value: { v: value } })
    .onConflictDoUpdate({ target: appState.key, set: { value: { v: value }, updatedAt: new Date() } })
}

export function factsKey(prefix: string, facts: unknown): string {
  return `ai:${prefix}:${createHash('sha256').update(JSON.stringify(facts)).digest('hex').slice(0, 24)}`
}

async function callText(opts: CallOptions, prompt: string, maxTokens: number): Promise<AiResult<string>> {
  const cached = await readCache<string>(opts.db, opts.cacheKey)
  if (cached) return { ok: true, value: cached, cached: true }
  const model = config.anthropicModel()
  const blocked = await guard(opts, maxTokens, model)
  if (blocked) return { ok: false, reason: blocked }
  const client = new Anthropic({ apiKey: config.anthropicKey()!, maxRetries: 1, timeout: 60_000 })
  const startedAt = new Date()
  try {
    const res = await client.beta.messages.create({
      model,
      max_tokens: maxTokens,
      ...fallbackOptions(model),
      output_config: { effort: 'low' },
      system: SYSTEM,
      messages: [{ role: 'user', content: prompt }],
    })
    await logJob(opts.db, {
      provider: PROVIDER,
      jobType: opts.jobType,
      status: 'succeeded',
      startedAt,
      requestCount: 1,
      estimatedCostUsd: costUsd(model, res.usage.input_tokens, res.usage.output_tokens),
      resultsCount: 1,
    })
    if (res.stop_reason === 'refusal') return { ok: false, reason: 'The AI declined this request.' }
    const text = res.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim()
    if (!text) return { ok: false, reason: 'The AI returned no text.' }
    await writeCache(opts.db, opts.cacheKey, text)
    return { ok: true, value: text, cached: false }
  } catch (err) {
    const message = err instanceof Anthropic.APIError ? `AI request failed (${err.status ?? 'network'}): ${err.message}` : 'AI request failed.'
    await logJob(opts.db, { provider: PROVIDER, jobType: opts.jobType, status: 'failed', startedAt, requestCount: 1, error: message })
    return { ok: false, reason: message }
  }
}

/** Plain-language explanation of a deal from computed facts only. */
export function explainDeal(opts: CallOptions, facts: Record<string, unknown>) {
  const prompt = `Explain in 3–5 sentences why this redemption is or is not a good use of Chase points, and the most important thing to verify before transferring. Facts (JSON):\n${JSON.stringify(facts, null, 2)}`
  return callText({ ...opts, cacheKey: opts.cacheKey ?? factsKey('explain', facts) }, prompt, 1500)
}

/** Short narrative for an assembled trip plan, from computed facts only. */
export function narrateTrip(opts: CallOptions, facts: Record<string, unknown>) {
  const prompt = `Write a 4–6 sentence description of this trip plan for the traveller: what makes it special, how the points and cash are split, and what is still missing or unverified. Facts (JSON):\n${JSON.stringify(facts, null, 2)}`
  return callText({ ...opts, cacheKey: opts.cacheKey ?? factsKey('trip', facts) }, prompt, 1500)
}

export const ideaSchema = z.object({
  ideas: z
    .array(
      z.object({
        destination: z.string(),
        country: z.string(),
        why: z.string(),
        bestMonths: z.string(),
        programsToCheck: z.array(z.string()),
        searchTip: z.string(),
      }),
    )
    .max(8),
})
export type DestinationIdeas = z.infer<typeof ideaSchema>

/** Destination inspiration matched to the owner's profile. Ideas only — never prices or availability. */
export async function destinationIdeas(opts: CallOptions, profile: Record<string, unknown>, programs: string[]): Promise<AiResult<DestinationIdeas>> {
  const cached = await readCache<DestinationIdeas>(opts.db, opts.cacheKey)
  if (cached) return { ok: true, value: cached, cached: true }
  const model = config.anthropicModel()
  const maxTokens = 3000
  const blocked = await guard(opts, maxTokens, model)
  if (blocked) return { ok: false, reason: blocked }
  const client = new Anthropic({ apiKey: config.anthropicKey()!, maxRetries: 1, timeout: 90_000 })
  const startedAt = new Date()
  try {
    const res = await client.beta.messages.parse({
      model,
      max_tokens: maxTokens,
      ...fallbackOptions(model),
      output_config: { effort: 'low', format: betaZodOutputFormat(ideaSchema) },
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: `Suggest up to 6 destinations this traveller would love that are often reachable with Chase Ultimate Rewards transfer partners. For programsToCheck use only names from this list: ${programs.join(', ')}. Do not mention prices, points amounts or availability. Traveller profile (JSON):\n${JSON.stringify(profile, null, 2)}`,
        },
      ],
    })
    await logJob(opts.db, {
      provider: PROVIDER,
      jobType: opts.jobType,
      status: 'succeeded',
      startedAt,
      requestCount: 1,
      estimatedCostUsd: costUsd(model, res.usage.input_tokens, res.usage.output_tokens),
      resultsCount: res.parsed_output?.ideas.length ?? 0,
    })
    if (res.stop_reason === 'refusal' || !res.parsed_output) return { ok: false, reason: 'The AI did not return usable ideas.' }
    await writeCache(opts.db, opts.cacheKey, res.parsed_output)
    return { ok: true, value: res.parsed_output, cached: false }
  } catch (err) {
    const message = err instanceof Anthropic.APIError ? `AI request failed (${err.status ?? 'network'}): ${err.message}` : 'AI request failed.'
    await logJob(opts.db, { provider: PROVIDER, jobType: opts.jobType, status: 'failed', startedAt, requestCount: 1, error: message })
    return { ok: false, reason: message }
  }
}
