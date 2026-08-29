TRUNCATE TABLE reviews, review_state, items, sessions, kanji, study_lists RESTART IDENTITY CASCADE;

-- A couple of existing vocab cards for "search & add".
INSERT INTO items (skill, prompt, answer, source, external_id) VALUES
('vocab',
 '{"sentence_ruby":"水","target":"水","sentence_english":"water"}',
 '{"meaning":"water","reading":"みず"}',
 'seed', 'study-001'),
('vocab',
 '{"sentence_ruby":"火","target":"火","sentence_english":"fire"}',
 '{"meaning":"fire","reading":"ひ"}',
 'seed', 'study-002');

-- A pre-built list long enough to exercise grouping + pagination: 25 vocab
-- cards (two pages at 20 per page) plus one kanji card, so the detail screen
-- shows two type sections.
INSERT INTO study_lists (id, title, description)
VALUES ('11111111-1111-1111-1111-111111111111', 'Long list', '');

INSERT INTO items (skill, prompt, answer, source, external_id)
SELECT 'vocab',
       jsonb_build_object('sentence_ruby', '語' || g, 'target', '語' || g, 'sentence_english', 'word ' || g),
       jsonb_build_object('meaning', 'word ' || g, 'reading', 'ご'),
       'seed', 'study-long-' || lpad(g::text, 2, '0')
  FROM generate_series(1, 25) g;

INSERT INTO items (skill, prompt, answer, source, external_id) VALUES
('kanji',
 '{"character":"日"}',
 '{"meanings":["sun","day"],"on":["ニチ"],"kun":["ひ"],"stroke_count":4}',
 'seed', 'study-long-kanji');

INSERT INTO study_list_items (list_id, item_id, position)
SELECT '11111111-1111-1111-1111-111111111111', id,
       row_number() OVER (ORDER BY external_id)
  FROM items WHERE external_id LIKE 'study-long-%';
