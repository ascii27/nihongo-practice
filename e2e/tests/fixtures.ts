import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function loadFixture(name: "seed-test-items" | "seed-test-empty"): void {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL required");
  const file = path.join(__dirname, "fixtures", `${name}.sql`);
  execSync(`psql "${dbUrl}" -f "${file}"`, { stdio: "inherit" });
}
