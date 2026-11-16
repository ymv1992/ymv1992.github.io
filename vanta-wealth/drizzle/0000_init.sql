CREATE SCHEMA IF NOT EXISTS "vanta";
--> statement-breakpoint
CREATE TABLE "vanta"."audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"action" text NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vanta"."audit_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "vanta"."auth_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ip" text NOT NULL,
	"success" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vanta"."auth_attempts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "vanta"."earnings_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"symbol" text NOT NULL,
	"day" date NOT NULL,
	"hour" text DEFAULT '' NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vanta"."earnings_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "vanta"."feed_state" (
	"key" text PRIMARY KEY NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "vanta"."feed_state" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "vanta"."holdings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account" text DEFAULT '' NOT NULL,
	"symbol" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"asset_class" text NOT NULL,
	"bucket" text NOT NULL,
	"quantity" double precision NOT NULL,
	"avg_cost" double precision,
	"status" text DEFAULT 'unverified' NOT NULL,
	"as_of" date,
	"purchase_date" date,
	"thesis" text DEFAULT '' NOT NULL,
	"sell_condition" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vanta"."holdings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "vanta"."manual_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"value" double precision,
	"liability" double precision DEFAULT 0 NOT NULL,
	"liquid" boolean DEFAULT false NOT NULL,
	"in_portfolio" boolean DEFAULT false NOT NULL,
	"bucket" text,
	"status" text DEFAULT 'unverified' NOT NULL,
	"as_of" date,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vanta"."manual_assets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "vanta"."news_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"symbol" text NOT NULL,
	"headline" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"source" text NOT NULL,
	"url" text NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vanta"."news_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "vanta"."notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"note_date" date NOT NULL,
	"symbol" text DEFAULT '' NOT NULL,
	"kind" text DEFAULT 'note' NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vanta"."notes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "vanta"."profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"data" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vanta"."profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "vanta"."quotes" (
	"symbol" text PRIMARY KEY NOT NULL,
	"price" double precision NOT NULL,
	"prev_close" double precision,
	"quote_time" timestamp with time zone,
	"fetched_at" timestamp with time zone NOT NULL,
	"source" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vanta"."quotes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "vanta"."snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"day" date NOT NULL,
	"portfolio_value" double precision NOT NULL,
	"cost_basis" double precision,
	"net_worth" double precision NOT NULL,
	"complete" boolean NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vanta"."snapshots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "vanta"."trades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"trade_date" date NOT NULL,
	"symbol" text NOT NULL,
	"account" text DEFAULT '' NOT NULL,
	"type" text NOT NULL,
	"quantity" double precision DEFAULT 0 NOT NULL,
	"price" double precision DEFAULT 0 NOT NULL,
	"fees" double precision DEFAULT 0 NOT NULL,
	"realized_gain" double precision,
	"applied_to_holding" boolean DEFAULT false NOT NULL,
	"thesis" text DEFAULT '' NOT NULL,
	"catalyst" text DEFAULT '' NOT NULL,
	"risk" text DEFAULT '' NOT NULL,
	"holding_period" text DEFAULT '' NOT NULL,
	"outcome" text DEFAULT '' NOT NULL,
	"lessons" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vanta"."trades" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "vanta"."users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"auth_identifier" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_auth_identifier_unique" UNIQUE("auth_identifier")
);
--> statement-breakpoint
ALTER TABLE "vanta"."users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "vanta"."watchlist" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"symbol" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"thesis" text DEFAULT '' NOT NULL,
	"target_price" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vanta"."watchlist" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "vanta"."audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "vanta"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vanta"."holdings" ADD CONSTRAINT "holdings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "vanta"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vanta"."manual_assets" ADD CONSTRAINT "manual_assets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "vanta"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vanta"."notes" ADD CONSTRAINT "notes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "vanta"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vanta"."profiles" ADD CONSTRAINT "profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "vanta"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vanta"."snapshots" ADD CONSTRAINT "snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "vanta"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vanta"."trades" ADD CONSTRAINT "trades_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "vanta"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vanta"."watchlist" ADD CONSTRAINT "watchlist_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "vanta"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_user_created" ON "vanta"."audit_log" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "earnings_symbol_day" ON "vanta"."earnings_events" USING btree ("symbol","day");--> statement-breakpoint
CREATE UNIQUE INDEX "holdings_user_account_symbol" ON "vanta"."holdings" USING btree ("user_id","account","symbol");--> statement-breakpoint
CREATE UNIQUE INDEX "news_symbol_url" ON "vanta"."news_items" USING btree ("symbol","url");--> statement-breakpoint
CREATE INDEX "news_published" ON "vanta"."news_items" USING btree ("published_at");--> statement-breakpoint
CREATE UNIQUE INDEX "snapshots_user_day" ON "vanta"."snapshots" USING btree ("user_id","day");--> statement-breakpoint
CREATE INDEX "trades_user_date" ON "vanta"."trades" USING btree ("user_id","trade_date");--> statement-breakpoint
CREATE UNIQUE INDEX "watchlist_user_symbol" ON "vanta"."watchlist" USING btree ("user_id","symbol");