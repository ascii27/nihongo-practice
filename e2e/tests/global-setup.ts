import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default async function globalSetup() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL required for e2e setup");
  const fixture = path.join(__dirname, "fixtures/seed-test-items.sql");
  execSync(`psql "${dbUrl}" -f "${fixture}"`, { stdio: "inherit" });
}
