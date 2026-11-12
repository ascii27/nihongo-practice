-- 1784073600000_study_lists_to_tags.sql
-- Study lists become tags. A list was always just a label on ordinary items —
-- members kept their own review_state and flowed through the normal SRS — so
-- the model now says so: `tags` + `item_tags`. Ids, names, descriptions and
-- members carry over; an item in several lists ends up with several tags.
-- `position` goes: there is no hand-ordering inside a tag.

-- Merge lists whose names collide case-/whitespace-insensitively into the
-- earliest-created one, before the unique index can reject them. Members are
-- unioned, keeping each item's earliest added_at.
WITH ranked AS (
  SELECT id, first_value(id) OVER (PARTITION BY lower(btrim(title)) ORDER BY created_at, id) AS keep_id
    FROM study_lists
), dupes AS (
  SELECT id, keep_id FROM ranked WHERE id <> keep_id
)
INSERT INTO study_list_items (list_id, item_id, position, added_at)
SELECT d.keep_id, sli.item_id, 0, min(sli.added_at)
  FROM study_list_items sli JOIN dupes d ON d.id = sli.list_id
 GROUP BY d.keep_id, sli.item_id
ON CONFLICT (list_id, item_id) DO UPDATE
  SET added_at = LEAST(study_list_items.added_at, EXCLUDED.added_at);

DELETE FROM study_lists sl
 USING (
   SELECT id, first_value(id) OVER (PARTITION BY lower(btrim(title)) ORDER BY created_at, id) AS keep_id
     FROM study_lists
 ) r
 WHERE sl.id = r.id AND r.id <> r.keep_id;

ALTER TABLE study_lists RENAME TO tags;
ALTER TABLE tags RENAME COLUMN title TO name;
ALTER TABLE tags RENAME CONSTRAINT study_lists_pkey TO tags_pkey;
UPDATE tags SET name = btrim(name);
CREATE UNIQUE INDEX tags_name_lower_idx ON tags (lower(btrim(name)));

ALTER TABLE study_list_items RENAME TO item_tags;
ALTER TABLE item_tags RENAME COLUMN list_id TO tag_id;
ALTER TABLE item_tags DROP COLUMN position;
ALTER TABLE item_tags RENAME CONSTRAINT study_list_items_pkey TO item_tags_pkey;
ALTER TABLE item_tags RENAME CONSTRAINT study_list_items_list_id_fkey TO item_tags_tag_id_fkey;
ALTER TABLE item_tags RENAME CONSTRAINT study_list_items_item_id_fkey TO item_tags_item_id_fkey;
ALTER INDEX study_list_items_list_idx RENAME TO item_tags_tag_idx;
CREATE INDEX item_tags_item_idx ON item_tags (item_id);

-- Session history records the whole focus, not just the skill.
ALTER TABLE sessions ADD COLUMN tag_filter uuid REFERENCES tags(id) ON DELETE SET NULL;
