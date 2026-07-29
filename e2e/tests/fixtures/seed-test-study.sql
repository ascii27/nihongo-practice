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
