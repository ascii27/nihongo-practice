-- 1779494400000_reviews_answer_given.sql
-- Phase 2.3: capture what the owner typed during conjugation drills.
-- Nullable because vocab/grammar/reading/particle don't use this.
ALTER TABLE reviews ADD COLUMN answer_given text;
