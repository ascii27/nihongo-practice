import { pool } from "./pool.js";

// Truncates application tables in FK order. Use in test beforeEach.
// pgmigrations is left alone so the schema stays migrated.
export async function resetDb(): Promise<void> {
  await pool.query(`
    TRUNCATE TABLE reviews, review_state, items, sessions, generations
    RESTART IDENTITY CASCADE
  `);
}
