import { describe, it, expect } from "vitest";
import { nextState, type ReviewStateRow } from "./leitner.js";

const NOW = new Date("2026-05-04T12:00:00.000Z");
const ONE_DAY = 24 * 60 * 60 * 1000;

function plusDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * ONE_DAY);
}

describe("nextState", () => {
  it("new item, got_it: box=1, next_review = now+1d, no missed", () => {
    const result = nextState(null, "got_it", NOW);
    expect(result.box).toBe(1);
    expect(result.next_review_at).toEqual(plusDays(NOW, 1));
    expect(result.total_reviews).toBe(1);
    expect(result.total_missed).toBe(0);
    expect(result.last_reviewed_at).toEqual(NOW);
  });

  it("new item, missed: box=1, next_review = now+1d, missed=1", () => {
    const result = nextState(null, "missed", NOW);
    expect(result.box).toBe(1);
    expect(result.next_review_at).toEqual(plusDays(NOW, 1));
    expect(result.total_reviews).toBe(1);
    expect(result.total_missed).toBe(1);
  });

  it("box 1 got_it -> box 2, +3d", () => {
    const prev: ReviewStateRow = {
      box: 1, total_reviews: 5, total_missed: 1,
      next_review_at: NOW, last_reviewed_at: NOW,
    };
    const result = nextState(prev, "got_it", NOW);
    expect(result.box).toBe(2);
    expect(result.next_review_at).toEqual(plusDays(NOW, 3));
    expect(result.total_reviews).toBe(6);
    expect(result.total_missed).toBe(1);
  });

  it("box 2 got_it -> box 3, +7d", () => {
    const prev: ReviewStateRow = { box: 2, total_reviews: 1, total_missed: 0, next_review_at: NOW, last_reviewed_at: NOW };
    expect(nextState(prev, "got_it", NOW).box).toBe(3);
    expect(nextState(prev, "got_it", NOW).next_review_at).toEqual(plusDays(NOW, 7));
  });

  it("box 3 got_it -> box 4, +14d", () => {
    const prev: ReviewStateRow = { box: 3, total_reviews: 1, total_missed: 0, next_review_at: NOW, last_reviewed_at: NOW };
    expect(nextState(prev, "got_it", NOW).box).toBe(4);
    expect(nextState(prev, "got_it", NOW).next_review_at).toEqual(plusDays(NOW, 14));
  });

  it("box 4 got_it -> box 5, +30d", () => {
    const prev: ReviewStateRow = { box: 4, total_reviews: 1, total_missed: 0, next_review_at: NOW, last_reviewed_at: NOW };
    expect(nextState(prev, "got_it", NOW).box).toBe(5);
    expect(nextState(prev, "got_it", NOW).next_review_at).toEqual(plusDays(NOW, 30));
  });

  it("box 5 got_it stays at box 5, +30d", () => {
    const prev: ReviewStateRow = { box: 5, total_reviews: 10, total_missed: 0, next_review_at: NOW, last_reviewed_at: NOW };
    expect(nextState(prev, "got_it", NOW).box).toBe(5);
    expect(nextState(prev, "got_it", NOW).next_review_at).toEqual(plusDays(NOW, 30));
  });

  it("missed from any box -> box 1, +1d, missed counter increments", () => {
    const prev: ReviewStateRow = { box: 4, total_reviews: 8, total_missed: 1, next_review_at: NOW, last_reviewed_at: NOW };
    const result = nextState(prev, "missed", NOW);
    expect(result.box).toBe(1);
    expect(result.next_review_at).toEqual(plusDays(NOW, 1));
    expect(result.total_reviews).toBe(9);
    expect(result.total_missed).toBe(2);
  });
});
