// What the practice engine plays. `scheduled` is the Daily tab's session (the
// focus, bounded by the daily target); `srs` is the SRS tab's (the whole deck,
// every due card); `drill` is "drill all anyway" on a focus. Only drill grades
// outside the schedule — srs submits ordinary scheduled reviews.
export type PracticeKind = "scheduled" | "srs" | "drill";

export type HeroTab = "daily" | "srs";

const KEY = "nihongo.heroTab";

// Remembered per device so finishing an SRS session lands back on SRS. Storage
// can be missing or throw, so the fallback is the Daily tab.
export function loadHeroTab(): HeroTab {
  try {
    return localStorage.getItem(KEY) === "srs" ? "srs" : "daily";
  } catch {
    return "daily";
  }
}

export function saveHeroTab(t: HeroTab): void {
  try { localStorage.setItem(KEY, t); } catch { /* storage unavailable */ }
}
