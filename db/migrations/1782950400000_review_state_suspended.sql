-- 1782950400000_review_state_suspended.sql
-- Auto-suspend chronic leeches. Items missed >= 8 times are hidden from the
-- queue (see queue.ts / reviews.ts) until manually revived. A revive UI is
-- future work; for now suspension is one-way.
ALTER TABLE review_state ADD COLUMN suspended boolean NOT NULL DEFAULT false;
