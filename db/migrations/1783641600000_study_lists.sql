-- 1783641600000_study_lists.sql
-- Custom study lists: a user-built collection mixing any skills (vocab /
-- grammar / kanji / …), mainly for class study. Mirrors the lessons header +
-- join-table shape. Members are ordinary `items`, so they keep their own
-- review_state and flow through the normal SRS; a list can also be crammed.

CREATE TABLE study_lists (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text NOT NULL,
  description text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE study_list_items (
  list_id  uuid NOT NULL REFERENCES study_lists(id) ON DELETE CASCADE,
  item_id  uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  position int  NOT NULL DEFAULT 0,
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (list_id, item_id)
);

CREATE INDEX study_list_items_list_idx ON study_list_items (list_id);
