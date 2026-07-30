-- 1783728000000_daily_target.sql
-- A bounded daily review goal. `app_settings` is a single-row singleton: the
-- boolean primary key with CHECK (id) makes a second row impossible, which is
-- the right shape for a single-user app. `daily_rounds` is day-scoped state
-- rather than a preference — one row per day the owner asked for extra work —
-- so it lives apart from the settings row.

CREATE TABLE app_settings (
  id                  boolean PRIMARY KEY DEFAULT true CHECK (id),
  daily_review_target int NOT NULL DEFAULT 30
    CHECK (daily_review_target BETWEEN 10 AND 100),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

INSERT INTO app_settings (id) VALUES (true);

CREATE TABLE daily_rounds (
  day          date PRIMARY KEY,
  extra_rounds int NOT NULL DEFAULT 0
);
