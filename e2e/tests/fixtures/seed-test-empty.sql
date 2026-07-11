-- Empty app state for e2e. grammar_points (migration-seeded reference data) is
-- intentionally preserved so lesson generation has a catalog to draw from.
TRUNCATE TABLE reviews, review_state, items, sessions, generations, lessons RESTART IDENTITY CASCADE;
