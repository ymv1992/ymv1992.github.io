CREATE TABLE "place_lookups" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trip_items" ADD COLUMN "lat" double precision;--> statement-breakpoint
ALTER TABLE "trip_items" ADD COLUMN "lng" double precision;--> statement-breakpoint
ALTER TABLE "trip_items" ADD COLUMN "map_span" double precision;--> statement-breakpoint
ALTER TABLE "trip_items" ADD COLUMN "photo" jsonb;--> statement-breakpoint
ALTER TABLE "trip_items" ADD COLUMN "media_checked_at" timestamp with time zone;