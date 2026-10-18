CREATE TABLE "announcements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"feed_url" text NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"published_at" timestamp with time zone,
	"matched_keywords" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_state" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_attempts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"ip" text NOT NULL,
	"success" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "data_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"source_type" text NOT NULL,
	"auth_requirements" text NOT NULL,
	"free_tier" text NOT NULL,
	"rate_limits" text NOT NULL,
	"usage_restrictions" text NOT NULL,
	"freshness" text NOT NULL,
	"reliability" text NOT NULL,
	"cache_ttl_hours" integer,
	"refresh_interval_hours" integer,
	"cost_per_request_usd" double precision DEFAULT 0 NOT NULL,
	"monthly_quota" integer,
	"daily_quota" integer,
	"enabled" boolean DEFAULT true NOT NULL,
	"health_status" text DEFAULT 'unknown' NOT NULL,
	"last_success_at" timestamp with time zone,
	"last_error_at" timestamp with time zone,
	"last_error" text,
	"docs_url" text,
	"notes" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deal_price_history" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"deal_id" uuid NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"program_points" integer,
	"chase_points" integer,
	"cash_usd" double precision,
	"mandatory_cash_usd" double precision,
	"availability" text NOT NULL,
	"source" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dedupe_key" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"dest_city" text NOT NULL,
	"dest_country" text NOT NULL,
	"dest_country_code" text,
	"dest_region" text NOT NULL,
	"dest_airport" text,
	"dest_lat" double precision,
	"dest_lon" double precision,
	"origin_airport" text,
	"provider_name" text NOT NULL,
	"program_id" text,
	"program_points" integer,
	"mandatory_cash_usd" double precision,
	"comparable_cash_usd" double precision,
	"comparable_cash_source" text DEFAULT 'unknown' NOT NULL,
	"comparable_cash_observed_at" timestamp with time zone,
	"alternative_cash_usd" double precision,
	"travel_start" date,
	"travel_end" date,
	"nights" integer,
	"flexible_dates" boolean DEFAULT false NOT NULL,
	"flight" jsonb,
	"hotel" jsonb,
	"cash_product" jsonb,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"source_kind" text NOT NULL,
	"source_name" text NOT NULL,
	"source_url" text,
	"source_ref" text,
	"collected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_verified_at" timestamp with time zone,
	"verification_method" text,
	"availability" text DEFAULT 'unknown' NOT NULL,
	"missing_info" text[] DEFAULT '{}'::text[] NOT NULL,
	"deadline_at" timestamp with time zone,
	"deadline_type" text DEFAULT 'none' NOT NULL,
	"deadline_source" text,
	"deadline_timezone" text,
	"why_noteworthy" text,
	"image_url" text,
	"image_credit" text,
	"booking_url" text,
	"assumed_bonus_percent" double precision,
	"cached_cpp" double precision,
	"cached_chase_points" integer,
	"archived_at" timestamp with time zone,
	"archive_reason" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"deal_id" uuid,
	"feedback_type" text NOT NULL,
	"rating" integer,
	"notes" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"undone_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "media_cache" (
	"query" text PRIMARY KEY NOT NULL,
	"url" text NOT NULL,
	"thumb_url" text,
	"credit_name" text,
	"credit_url" text,
	"provider" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"deal_id" uuid,
	"promotion_id" uuid,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"link" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"status" text NOT NULL,
	"email_status" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "points_wallets" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"chase_balance" integer DEFAULT 150000 NOT NULL,
	"card_type" text DEFAULT 'sapphire_preferred' NOT NULL,
	"partner_balances" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_deal_collections" (
	"saved_deal_id" uuid NOT NULL,
	"collection_id" uuid NOT NULL,
	CONSTRAINT "saved_deal_collections_saved_deal_id_collection_id_pk" PRIMARY KEY("saved_deal_id","collection_id")
);
--> statement-breakpoint
CREATE TABLE "saved_deals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"deal_id" uuid NOT NULL,
	"notes" text,
	"saved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"original_program_points" integer,
	"original_chase_points" integer,
	"original_cash_usd" double precision,
	"original_comparable_usd" double precision,
	"original_cpp" double precision,
	"latest_program_points" integer,
	"latest_chase_points" integer,
	"latest_cpp" double precision,
	"latest_observed_at" timestamp with time zone,
	"alert_price_drop" boolean DEFAULT true NOT NULL,
	"alert_availability" boolean DEFAULT true NOT NULL,
	"alert_deadline" boolean DEFAULT true NOT NULL,
	"rating" integer,
	"archived_at" timestamp with time zone,
	"booked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "search_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"context" text NOT NULL,
	"query" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "search_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"job_type" text NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text NOT NULL,
	"priority" double precision,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"duration_ms" integer,
	"request_count" integer DEFAULT 0 NOT NULL,
	"estimated_cost_usd" double precision DEFAULT 0 NOT NULL,
	"results_count" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transfer_partners" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"program_name" text NOT NULL,
	"type" text NOT NULL,
	"alliance" text,
	"base_ratio_chase" integer DEFAULT 1 NOT NULL,
	"base_ratio_partner" integer DEFAULT 1 NOT NULL,
	"card_ratio_overrides" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"min_transfer" integer DEFAULT 1000 NOT NULL,
	"transfer_increment" integer DEFAULT 1000 NOT NULL,
	"bonus_rounding" text DEFAULT 'floor' NOT NULL,
	"processing_time" text DEFAULT 'Unknown' NOT NULL,
	"restrictions" text,
	"booking_limitations" text,
	"transfer_instructions" text,
	"program_url" text,
	"source_urls" text[] DEFAULT '{}'::text[] NOT NULL,
	"last_verified_at" timestamp with time zone,
	"verification_status" text DEFAULT 'research_seed' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"typical_value_cents" double precision,
	"notes" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transfer_promotions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_id" text NOT NULL,
	"bonus_percent" double precision NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"ends_at_timezone" text,
	"eligible_card_types" text[],
	"is_targeted" boolean DEFAULT false NOT NULL,
	"eligibility" text,
	"source_url" text,
	"source_kind" text NOT NULL,
	"verification_status" text NOT NULL,
	"last_verified_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "travel_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"trip_styles" text[] DEFAULT '{}'::text[] NOT NULL,
	"tag_preferences" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"learned_weights" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"home_airports" text[] DEFAULT '{}'::text[] NOT NULL,
	"max_cash_usd" double precision DEFAULT 1000 NOT NULL,
	"max_points" integer,
	"trip_nights_min" integer,
	"trip_nights_max" integer,
	"max_flight_hours" double precision,
	"date_flexibility" text DEFAULT 'few_weeks' NOT NULL,
	"visited" text[] DEFAULT '{}'::text[] NOT NULL,
	"dream_destinations" text[] DEFAULT '{}'::text[] NOT NULL,
	"deal_breakers" text[] DEFAULT '{}'::text[] NOT NULL,
	"preferred_categories" text[] DEFAULT '{}'::text[] NOT NULL,
	"prefer_new_places" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"demo_mode" boolean DEFAULT true NOT NULL,
	"onboarding_completed_at" timestamp with time zone,
	"point_floor_cents" double precision DEFAULT 1 NOT NULL,
	"min_acceptable_cpp" double precision DEFAULT 1.5 NOT NULL,
	"monthly_api_budget_usd" double precision DEFAULT 5 NOT NULL,
	"ai_enabled" boolean DEFAULT false NOT NULL,
	"ai_monthly_budget_usd" double precision DEFAULT 2 NOT NULL,
	"email_enabled" boolean DEFAULT false NOT NULL,
	"notification_email" text,
	"browser_notifications" boolean DEFAULT false NOT NULL,
	"timezone" text DEFAULT 'America/Los_Angeles' NOT NULL,
	"alert_prefs" jsonb,
	"food_per_person_per_day_usd" double precision DEFAULT 100 NOT NULL,
	"travelers" integer DEFAULT 2 NOT NULL,
	"active_profile_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"auth_identifier" text NOT NULL,
	"display_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone,
	CONSTRAINT "users_auth_identifier_unique" UNIQUE("auth_identifier")
);
--> statement-breakpoint
CREATE TABLE "watchlists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"deal_id" uuid,
	"label" text NOT NULL,
	"origins" text[] DEFAULT '{}'::text[] NOT NULL,
	"destinations" text[] DEFAULT '{}'::text[] NOT NULL,
	"property" text,
	"program_id" text,
	"cabin" text,
	"date_from" date,
	"date_to" date,
	"criteria" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"refresh_hours" integer DEFAULT 24 NOT NULL,
	"provider" text,
	"auto_check_supported" boolean DEFAULT false NOT NULL,
	"last_checked_at" timestamp with time zone,
	"unchanged_streak" integer DEFAULT 0 NOT NULL,
	"last_result_hash" text,
	"last_error" text,
	"active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_price_history" ADD CONSTRAINT "deal_price_history_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_promotion_id_transfer_promotions_id_fk" FOREIGN KEY ("promotion_id") REFERENCES "public"."transfer_promotions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "points_wallets" ADD CONSTRAINT "points_wallets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_deal_collections" ADD CONSTRAINT "saved_deal_collections_saved_deal_id_saved_deals_id_fk" FOREIGN KEY ("saved_deal_id") REFERENCES "public"."saved_deals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_deal_collections" ADD CONSTRAINT "saved_deal_collections_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_deals" ADD CONSTRAINT "saved_deals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_deals" ADD CONSTRAINT "saved_deals_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_history" ADD CONSTRAINT "search_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_promotions" ADD CONSTRAINT "transfer_promotions_partner_id_transfer_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."transfer_partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_profiles" ADD CONSTRAINT "travel_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlists" ADD CONSTRAINT "watchlists_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlists" ADD CONSTRAINT "watchlists_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "announcements_url_idx" ON "announcements" USING btree ("url");--> statement-breakpoint
CREATE INDEX "auth_attempts_ip_time_idx" ON "auth_attempts" USING btree ("ip","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "collections_user_name_idx" ON "collections" USING btree ("user_id","name");--> statement-breakpoint
CREATE INDEX "deal_price_history_deal_time_idx" ON "deal_price_history" USING btree ("deal_id","observed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "deals_dedupe_key_idx" ON "deals" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "deals_travel_start_idx" ON "deals" USING btree ("travel_start");--> statement-breakpoint
CREATE INDEX "deals_route_idx" ON "deals" USING btree ("origin_airport","dest_airport");--> statement-breakpoint
CREATE INDEX "deals_cpp_idx" ON "deals" USING btree ("cached_cpp");--> statement-breakpoint
CREATE INDEX "deals_archived_idx" ON "deals" USING btree ("archived_at");--> statement-breakpoint
CREATE INDEX "deals_source_kind_idx" ON "deals" USING btree ("source_kind");--> statement-breakpoint
CREATE INDEX "deals_verified_idx" ON "deals" USING btree ("last_verified_at");--> statement-breakpoint
CREATE INDEX "deals_deadline_idx" ON "deals" USING btree ("deadline_at");--> statement-breakpoint
CREATE INDEX "feedback_user_deal_idx" ON "feedback" USING btree ("user_id","deal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_user_dedupe_idx" ON "notifications" USING btree ("user_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "notifications_user_created_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "saved_deals_user_deal_idx" ON "saved_deals" USING btree ("user_id","deal_id");--> statement-breakpoint
CREATE INDEX "saved_deals_user_idx" ON "saved_deals" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "search_jobs_provider_time_idx" ON "search_jobs" USING btree ("provider","created_at");--> statement-breakpoint
CREATE INDEX "search_jobs_status_idx" ON "search_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "transfer_promotions_partner_idx" ON "transfer_promotions" USING btree ("partner_id");--> statement-breakpoint
CREATE INDEX "transfer_promotions_ends_idx" ON "transfer_promotions" USING btree ("ends_at");--> statement-breakpoint
CREATE INDEX "travel_profiles_user_idx" ON "travel_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "watchlists_user_idx" ON "watchlists" USING btree ("user_id");