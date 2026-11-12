-- Empty app state for e2e. grammar_points (migration-seeded reference data) is
-- Settings are a seeded singleton that specs may change; reset to the default.
UPDATE app_settings SET daily_review_target = 30;
-- intentionally preserved so lesson generation has a catalog to draw from.
TRUNCATE TABLE reviews, review_state, items, sessions, generations, lessons RESTART IDENTITY CASCADE;
