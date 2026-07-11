import { pool } from "./pool.js";

// Truncates application tables in FK order. Use in test beforeEach.
// pgmigrations and grammar_points (seeded reference data) are left alone so the
// schema stays migrated and the grammar catalog stays available to tests.
export async function resetDb(): Promise<void> {
  await pool.query(`
    TRUNCATE TABLE reviews, review_state, items, sessions, generations, lessons
    RESTART IDENTITY CASCADE
  `);
}
