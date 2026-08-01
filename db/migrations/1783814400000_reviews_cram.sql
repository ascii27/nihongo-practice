-- 1783814400000_reviews_cram.sql
-- Cram (drilling a study list) grades through the same POST /api/reviews as
-- scheduled practice, so its rows were indistinguishable from ordinary review
-- history. That let a 40-card cram before class consume the whole daily review
-- allowance and leave every practice entry point empty until midnight. The
-- daily budget must be able to tell the two apart.
--
-- Marked explicitly rather than inferred from `session_id IS NULL`: cram
-- happening to run without a session is a property of today's client, not a
-- contract, and would break silently if the session flow changed.
--
-- Defaults false so all existing history reads as ordinary practice, which is
-- what it was — cram is the new, narrower case.

ALTER TABLE reviews ADD COLUMN cram boolean NOT NULL DEFAULT false;
