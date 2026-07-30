import { pool } from "./pool.js";

// Truncates application tables in FK order. Use in test beforeEach.
// pgmigrations and grammar_points (seeded reference data) are left alone so the
// schema stays migrated and the grammar catalog stays available to tests.
// app_settings is a seeded singleton — reset its values rather than truncating,
// or every test would run against a table with no settings row.
export async function resetDb(): Promise<void> {
  await pool.query(`
    TRUNCATE TABLE reviews, review_state, items, sessions, generations, lessons, kanji, study_lists, daily_rounds
    RESTART IDENTITY CASCADE
  `);
  await pool.query(`UPDATE app_settings SET daily_review_target = 30, updated_at = now()`);
}
