import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default async function globalSetup() {
  // Read-only runs point at production: never truncate or seed anything.
  if (process.env.E2E_READ_ONLY === "1") return;
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL required for e2e setup");
  const fixture = path.join(__dirname, "fixtures/seed-test-items.sql");
  execSync(`psql "${dbUrl}" -f "${fixture}"`, { stdio: "inherit" });
}
