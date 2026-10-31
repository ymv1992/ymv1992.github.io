CREATE TABLE "trip_packing_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"label" text NOT NULL,
	"category" text DEFAULT 'other' NOT NULL,
	"reason" text,
	"packed" boolean DEFAULT false NOT NULL,
	"dismissed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trip_items" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "trip_items" ADD COLUMN "country_code" text;--> statement-breakpoint
ALTER TABLE "trip_items" ADD COLUMN "city_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "trip_packing_items" ADD CONSTRAINT "trip_packing_items_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trip_packing_trip_idx" ON "trip_packing_items" USING btree ("trip_id");