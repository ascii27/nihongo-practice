-- Journeys: the tags fixture (vocab 水/火, a 25-card "Long list", kanji 日,
-- "Coto Academy" = 水 + 日, 30 untagged filler) plus the card shapes that are
-- tallest on a phone, so fit-to-viewport checks meet realistic content.
\ir seed-test-tags.sql

INSERT INTO items (skill, prompt, answer, source, external_id) VALUES
('grammar',
 '{"pattern":"〜てから","sentence_ruby":"<ruby>宿題<rt>しゅくだい</rt></ruby>をしてから<ruby>寝<rt>ね</rt></ruby>ます。","sentence_english":"After doing homework I sleep."}',
 '{"explanation":"〜てから joins the te-form to a following action and means \"after doing X, (then) Y\". The first action is completed before the second begins, so it stresses sequence more than 〜て alone."}',
 'seed', 'journey-grammar-1'),
-- A long passage: the review card must keep its grade buttons reachable.
('reading',
 jsonb_build_object(
   'passage_ruby', repeat('<ruby>山田<rt>やまだ</rt></ruby>さんは<ruby>毎朝<rt>まいあさ</rt></ruby><ruby>六時<rt>ろくじ</rt></ruby>に<ruby>起き<rt>おき</rt></ruby>ます。コーヒーを<ruby>飲ん<rt>のん</rt></ruby>で、<ruby>新聞<rt>しんぶん</rt></ruby>を<ruby>読み<rt>よみ</rt></ruby>ます。それから<ruby>会社<rt>かいしゃ</rt></ruby>へ<ruby>行き<rt>いき</rt></ruby>ます。', 6),
   'question_english', 'What does Yamada-san do after drinking coffee?'),
 '{"answer_english":"He reads the newspaper.","answer_japanese_ruby":"<ruby>新聞<rt>しんぶん</rt></ruby>を<ruby>読み<rt>よみ</rt></ruby>ます。"}',
 'seed', 'journey-reading-long');

-- The grammar card is class material too.
INSERT INTO item_tags (tag_id, item_id)
SELECT '22222222-2222-2222-2222-222222222222', id FROM items WHERE external_id = 'journey-grammar-1';
