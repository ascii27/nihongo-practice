import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    // Test files share a single Postgres database. Running them in parallel
    // causes FK violations between one file's resetDb() and another file's
    // INSERT. Serialize by running all files in one worker.
    fileParallelism: false,
    include: [
      "src/**/*.test.ts",
      "../shared/src/**/*.test.ts",
    ],
  },
});
