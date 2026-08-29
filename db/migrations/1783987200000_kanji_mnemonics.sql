-- 1783987200000_kanji_mnemonics.sql
-- One generated mnemonic per kanji: an absurd scene for the meaning plus an
-- English sound hook and example sentence per important reading. Kept apart
-- from the `kanji` reference table because `import-kanji` re-upserts those rows
-- wholesale, and because generated content carries a model, a cost, and can be
-- thrown away and remade. Filled lazily, the first time a learner opens the
-- Mnemonic tab for a character.

CREATE TABLE kanji_mnemonics (
  character     text PRIMARY KEY REFERENCES kanji(character) ON DELETE CASCADE,
  content       jsonb NOT NULL,
  model         text NOT NULL,
  cost_usd      numeric(10,6) NOT NULL DEFAULT 0,
  generated_at  timestamptz NOT NULL DEFAULT now()
);
