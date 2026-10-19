import 'server-only'
import { getDb } from '../db/client'
import { runJobs, type JobMode } from '../jobs/run'
import { sendEmail } from '../providers/email'
import { config } from './config'

export async function runScheduled(mode: JobMode, onlyUserId?: string) {
  const db = await getDb()
  return runJobs(
    db,
    {
      now: new Date(),
      sendEmail,
      appUrl: config.appUrl(),
      keys: { seatsAero: config.seatsAeroKey(), serpApi: config.serpApiKey(), unsplash: config.unsplashKey() },
      rssFeeds: config.rssFeeds(),
      fetch,
    },
    mode,
    onlyUserId,
  )
}
