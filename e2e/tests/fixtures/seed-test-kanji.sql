TRUNCATE TABLE reviews, review_state, items, sessions, kanji RESTART IDENTITY CASCADE;

-- One kanji reference row (simple placeholder stroke paths) + its review item.
INSERT INTO kanji (character, strokes, stroke_count, radical, meanings, on_yomi, kun_yomi, grade, jlpt) VALUES
('食',
 '["M20,30 L54,15","M20,45 L88,45","M30,65 L78,65"]',
 3, '人',
 ARRAY['eat','food'], ARRAY['ショク'], ARRAY['た.べる'], 2, 'N4');

INSERT INTO items (skill, prompt, answer, source, external_id) VALUES
('kanji',
 '{"character":"食"}',
 '{"meanings":["eat","food"],"on":["ショク"],"kun":["た.べる"],"stroke_count":3}',
 'seed', '食');
