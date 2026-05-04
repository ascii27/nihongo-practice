import path from "node:path";
import { fileURLToPath } from "node:url";
import migrationRunner from "node-pg-migrate";
import { env } from "../env.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(__dirname, "../../../db/migrations");

const direction = (process.argv[2] === "down" ? "down" : "up") as "up" | "down";

await migrationRunner({
  databaseUrl: env.DATABASE_URL,
  dir: migrationsDir,
  migrationsTable: "pgmigrations",
  direction,
  count: Infinity,
  log: console.log,
});

process.exit(0);
