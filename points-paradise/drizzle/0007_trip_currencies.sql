ALTER TABLE "trip_items" ADD COLUMN "cost_amount" double precision;--> statement-breakpoint
ALTER TABLE "trip_items" ADD COLUMN "cost_currency" text DEFAULT 'USD' NOT NULL;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "currency" text;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "rates" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
-- Existing costs were in dollars. The old cost_usd column stays (unused) until a later release, so the version still serving during deploy keeps working.
UPDATE "trip_items" SET "cost_amount" = "cost_usd", "cost_currency" = 'USD' WHERE "cost_usd" IS NOT NULL AND "cost_amount" IS NULL;
