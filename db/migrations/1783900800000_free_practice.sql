-- 1783900800000_free_practice.sql
-- Generalise `reviews.cram` to `reviews.free_practice`.
--
-- The column was added for cram, but cram is not the only practice that sits
-- outside the daily allowance: tapping a skill row on Today is free practice
-- too — deliberate extra drilling the owner asked for, not a draw against the
-- day's plan. One flag now answers one question for both: does this review
-- count toward the daily target?
--
-- A rename rather than a second boolean: two columns meaning "doesn't count"
-- would invite them to disagree. Safe to rename — the column shipped in the
-- same unreleased feature branch and no row has ever been flagged.

ALTER TABLE reviews RENAME COLUMN cram TO free_practice;
