-- The live version stopped using cost_usd in 0007 (amounts moved to cost_amount), so it can go now.
ALTER TABLE "trip_items" DROP COLUMN "cost_usd";--> statement-breakpoint
-- Items whose map lookup found nothing (for example share.google links, which weren't read before) are offered again under "Find maps & photos".
UPDATE "trip_items" SET "media_checked_at" = NULL WHERE "lat" IS NULL AND ("kind" <> 'note' OR "place" IS NOT NULL OR "url" IS NOT NULL);--> statement-breakpoint
-- Lookups cached under the old key format are no longer read.
DELETE FROM "place_lookups" WHERE "key" LIKE 'v1|%';
