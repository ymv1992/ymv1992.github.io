-- SerpApi's free plan allows 250 searches a month; keep the app at 200, leaving a margin.
-- Only rows still at the original default are changed, so an owner's own setting is kept.
UPDATE "data_sources" SET "monthly_quota" = 200, "free_tier" = '250 free searches a month (the app uses at most 200)' WHERE "id" IN ('serpapi_flights', 'serpapi_hotels') AND "monthly_quota" = 100;
