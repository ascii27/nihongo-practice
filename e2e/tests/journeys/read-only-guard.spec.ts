// The read-only guard is the safety net for production runs, so it gets its
// own test: under E2E_READ_ONLY=1 a write must be blocked and fail the test.
import { test, expect, READ_ONLY } from "./support";

test("@readonly the guard blocks writes in read-only runs", async ({ page }) => {
  test.skip(!READ_ONLY, "only meaningful with E2E_READ_ONLY=1");
  test.fail(true, "the guard must fail a test that attempts a write");
  await page.goto("/");
  await page.evaluate(() => fetch("/api/tags", { method: "POST", body: "{}" }).catch(() => {}));
  await page.waitForTimeout(200);
  expect(true).toBe(true);
});
