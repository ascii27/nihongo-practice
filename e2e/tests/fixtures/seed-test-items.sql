TRUNCATE TABLE reviews, review_state, items, sessions, daily_rounds RESTART IDENTITY CASCADE;

-- app_settings is a seeded singleton — reset its value rather than truncating,
-- or the app would run against a table with no settings row. Mirrors resetDb().
UPDATE app_settings SET daily_review_target = 30, updated_at = now();

INSERT INTO items (skill, prompt, answer, source, external_id) VALUES
('vocab',
 '{"sentence_ruby":"<ruby>水<rt>みず</rt></ruby>を<ruby>飲<rt>の</rt></ruby>みます。","target":"水","sentence_english":"I drink water."}',
 '{"meaning":"water","reading":"みず"}',
 'seed', 'e2e-001'),
('vocab',
 '{"sentence_ruby":"<ruby>本<rt>ほん</rt></ruby>を<ruby>読<rt>よ</rt></ruby>みます。","target":"本","sentence_english":"I read a book."}',
 '{"meaning":"book","reading":"ほん"}',
 'seed', 'e2e-002'),
('vocab',
 '{"sentence_ruby":"<ruby>食<rt>た</rt></ruby>べます。","target":"食べる","sentence_english":"I eat."}',
 '{"meaning":"to eat","reading":"たべる"}',
 'seed', 'e2e-003');
