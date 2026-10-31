CREATE TABLE "trip_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"source" text NOT NULL,
	"key" text NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"data" jsonb NOT NULL,
	"item_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trip_suggestions" ADD CONSTRAINT "trip_suggestions_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_suggestions" ADD CONSTRAINT "trip_suggestions_item_id_trip_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."trip_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "trip_suggestions_key_idx" ON "trip_suggestions" USING btree ("trip_id","source","key");