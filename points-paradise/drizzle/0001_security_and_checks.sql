-- Row-level security: enabled with no policies, so Supabase's public API roles (anon, authenticated)
-- cannot read or write any table. The app connects as the table owner, which bypasses RLS.
-- If you later add Supabase Auth for multiple users, add per-user policies here.
ALTER TABLE "announcements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "app_state" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "auth_attempts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "collections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "data_sources" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "deal_price_history" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "deals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "feedback" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "media_cache" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "points_wallets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "saved_deal_collections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "saved_deals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "search_history" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "search_jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "transfer_partners" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "transfer_promotions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "travel_profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "user_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "watchlists" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- Validation constraints
ALTER TABLE "deals" ADD CONSTRAINT "deals_program_points_nonneg" CHECK ("program_points" IS NULL OR "program_points" >= 0);--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_cash_nonneg" CHECK (("mandatory_cash_usd" IS NULL OR "mandatory_cash_usd" >= 0) AND ("comparable_cash_usd" IS NULL OR "comparable_cash_usd" >= 0) AND ("alternative_cash_usd" IS NULL OR "alternative_cash_usd" >= 0));--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_kind_valid" CHECK ("kind" IN ('flight', 'hotel', 'package', 'experience'));--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_source_kind_valid" CHECK ("source_kind" IN ('api', 'manual', 'announcement', 'research', 'demo', 'prediction'));--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_availability_valid" CHECK ("availability" IN ('available', 'unavailable', 'unknown'));--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_deadline_type_valid" CHECK ("deadline_type" IN ('confirmed', 'observed', 'estimated', 'none'));--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_dates_ordered" CHECK ("travel_end" IS NULL OR "travel_start" IS NULL OR "travel_end" >= "travel_start");--> statement-breakpoint
ALTER TABLE "points_wallets" ADD CONSTRAINT "points_wallets_balance_nonneg" CHECK ("chase_balance" >= 0);--> statement-breakpoint
ALTER TABLE "transfer_promotions" ADD CONSTRAINT "transfer_promotions_bonus_range" CHECK ("bonus_percent" > 0 AND "bonus_percent" <= 300);--> statement-breakpoint
ALTER TABLE "transfer_partners" ADD CONSTRAINT "transfer_partners_ratio_positive" CHECK ("base_ratio_chase" > 0 AND "base_ratio_partner" > 0 AND "min_transfer" > 0 AND "transfer_increment" > 0);--> statement-breakpoint
ALTER TABLE "saved_deals" ADD CONSTRAINT "saved_deals_rating_range" CHECK ("rating" IS NULL OR ("rating" BETWEEN 1 AND 5));--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_rating_range" CHECK ("rating" IS NULL OR ("rating" BETWEEN 1 AND 5));
