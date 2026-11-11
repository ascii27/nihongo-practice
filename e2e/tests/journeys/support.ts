import { test as base, expect, type Locator, type Page } from "@playwright/test";
import { loadFixture } from "../fixtures";
import { PASSCODE } from "../helpers";

// iPhone 17 opened from the Home Screen: the app draws under the status bar
// (viewport-fit=cover + black-translucent), so iOS reports these insets.
// Chromium reports 0 for env(safe-area-inset-*), which is exactly how layouts
// that overflow on the phone passed every test — so the journeys set the CSS
// tokens the app reads instead (see client/src/styles/tokens.css).
export const IPHONE_17 = { width: 402, height: 874, safeTop: 62, safeBottom: 34 };

// Read-only runs (E2E_READ_ONLY=1, used against production) must not change
// anything: any non-GET /api request fails the test instead of reaching the
// server, and fixtures (which truncate tables) refuse to load.
export const READ_ONLY = process.env.E2E_READ_ONLY === "1";
const READ_ONLY_POSTS = new Set(["/api/auth/check"]);

type Fixtures = { readOnlyGuard: void; phoneInsets: void };

export const test = base.extend<Fixtures>({
  readOnlyGuard: [async ({ page }, use) => {
    const blocked: string[] = [];
    if (READ_ONLY) {
      await page.route("**/api/**", (route) => {
        const req = route.request();
        const path = new URL(req.url()).pathname;
        // GETs read. The one non-GET that only reads is the passcode check
        // login makes; everything else is blocked.
        if (req.method() === "GET" || READ_ONLY_POSTS.has(path)) return route.continue();
        blocked.push(`${req.method()} ${path}`);
        return route.abort("blockedbyclient");
      });
    }
    await use();
    expect(blocked, "read-only run attempted writes").toEqual([]);
  }, { auto: true }],

  phoneInsets: [async ({ page }, use) => {
    await page.addInitScript(({ top, bottom }) => {
      const apply = () => {
        document.documentElement.style.setProperty("--safe-top", `${top}px`);
        document.documentElement.style.setProperty("--safe-bottom", `${bottom}px`);
      };
      if (document.documentElement) apply();
      else document.addEventListener("DOMContentLoaded", apply);
    }, { top: IPHONE_17.safeTop, bottom: IPHONE_17.safeBottom });
    await use();
  }, { auto: true }],
});

export { expect };

// Load a fixture for a journey that writes. Read-only runs skip the journey.
export function seed(name: Parameters<typeof loadFixture>[0]): void {
  test.skip(READ_ONLY, "writes data — local only");
  loadFixture(name);
}

export async function login(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Passcode").fill(PASSCODE);
  await page.getByRole("button", { name: /enter/i }).click();
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
}

// The screen fits the phone: the page itself doesn't scroll (a screen may
// scroll its own content, the document must not), and every control named is
// wholly inside the usable area — below the status bar, and above the tab bar
// when one is showing, else above the home indicator.
export async function expectFits(page: Page, step: string, controls: Locator[] = []): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
  expect(overflow, `${step}: the page scrolls by ${overflow}px`).toBeLessThanOrEqual(1);
  const tabbar = page.locator(".tabbar");
  const floor = (await tabbar.isVisible())
    ? (await tabbar.boundingBox())!.y
    : IPHONE_17.height - IPHONE_17.safeBottom;
  for (const c of controls) {
    await expect(c, step).toBeVisible();
    const box = (await c.boundingBox())!;
    expect(box.y, `${step}: ${c} is under the status bar`).toBeGreaterThanOrEqual(IPHONE_17.safeTop - 1);
    expect(box.y + box.height, `${step}: ${c} is cut off at the bottom (floor ${floor})`).toBeLessThanOrEqual(floor + 1);
  }
}
