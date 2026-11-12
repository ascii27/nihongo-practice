import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function loadFixture(name: "seed-test-items" | "seed-test-empty" | "seed-test-kanji" | "seed-test-tags" | "seed-journeys"): void {
  // Fixtures truncate tables: never against a read-only (production) run.
  if (process.env.E2E_READ_ONLY === "1") throw new Error("loadFixture refused: E2E_READ_ONLY=1");
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL required");
  const file = path.join(__dirname, "fixtures", `${name}.sql`);
  execSync(`psql "${dbUrl}" -f "${file}"`, { stdio: "inherit" });
}
