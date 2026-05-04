export type ReviewStateRow = {
  box: number;
  next_review_at: Date;
  last_reviewed_at: Date | null;
  total_reviews: number;
  total_missed: number;
};

export type ReviewResult = "got_it" | "missed";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const INTERVAL_DAYS = [1, 3, 7, 14, 30] as const;  // 1-indexed via box-1

function plusDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * ONE_DAY_MS);
}

export function nextState(
  prev: ReviewStateRow | null,
  result: ReviewResult,
  now: Date,
): ReviewStateRow {
  const totalReviews = (prev?.total_reviews ?? 0) + 1;
  const totalMissed = (prev?.total_missed ?? 0) + (result === "missed" ? 1 : 0);

  if (prev === null) {
    // New item: first attempt is exposure. Always +1d, box stays 1.
    return {
      box: 1,
      next_review_at: plusDays(now, 1),
      last_reviewed_at: now,
      total_reviews: totalReviews,
      total_missed: totalMissed,
    };
  }

  if (result === "missed") {
    return {
      box: 1,
      next_review_at: plusDays(now, 1),
      last_reviewed_at: now,
      total_reviews: totalReviews,
      total_missed: totalMissed,
    };
  }

  const nextBox = Math.min(prev.box + 1, 5);
  const interval = INTERVAL_DAYS[nextBox - 1]!;
  return {
    box: nextBox,
    next_review_at: plusDays(now, interval),
    last_reviewed_at: now,
    total_reviews: totalReviews,
    total_missed: totalMissed,
  };
}
