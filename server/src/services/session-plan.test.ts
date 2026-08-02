import { describe, it, expect } from "vitest";
import { planSession, sessionSize, DEFAULT_QUEUE_LIMIT } from "./session-plan.js";

// A budget shaped like `getDailyBudget` returns, with only the fields the
// planner reads. `reviewed`/`allowance` are irrelevant here — `remaining` is
// what constrains the session.
function budget(o: { target?: number; extra_rounds?: number; remaining?: number } = {}) {
  return { target: o.target ?? 30, extra_rounds: o.extra_rounds ?? 0, remaining: o.remaining ?? 30 };
}

describe("planSession", () => {
  it("reproduces the historical 10-new/20-due split at the default target", () => {
    const plan = planSession(budget(), 0, DEFAULT_QUEUE_LIMIT);
    expect(plan).toEqual({ sessionCap: 30, newLimit: 10 });
  });

  it("caps the session at whatever the budget has left", () => {
    const plan = planSession(budget({ remaining: 7 }), 0, DEFAULT_QUEUE_LIMIT);
    expect(plan.sessionCap).toBe(7);
  });

  it("caps the session at the caller's limit when that is smaller", () => {
    const plan = planSession(budget(), 0, 5);
    expect(plan.sessionCap).toBe(5);
    // The new share (10) cannot exceed the session itself.
    expect(plan.newLimit).toBe(5);
  });

  it("plans nothing once the budget is spent", () => {
    expect(planSession(budget({ remaining: 0 }), 0, DEFAULT_QUEUE_LIMIT))
      .toEqual({ sessionCap: 0, newLimit: 0 });
  });

  it("subtracts cards already introduced today from the new share", () => {
    expect(planSession(budget(), 4, DEFAULT_QUEUE_LIMIT).newLimit).toBe(6);
  });

  it("floors the new share at zero when the day's introductions are used up", () => {
    expect(planSession(budget(), 40, DEFAULT_QUEUE_LIMIT).newLimit).toBe(0);
  });

  it("grows the new share with each unlocked round", () => {
    const plan = planSession(budget({ extra_rounds: 1, remaining: 60 }), 0, DEFAULT_QUEUE_LIMIT);
    expect(plan).toEqual({ sessionCap: 60, newLimit: 20 });
  });

  it("scales the new share with the target", () => {
    expect(planSession(budget({ target: 100, remaining: 100 }), 0, DEFAULT_QUEUE_LIMIT).newLimit).toBe(33);
    expect(planSession(budget({ target: 10, remaining: 10 }), 0, DEFAULT_QUEUE_LIMIT).newLimit).toBe(3);
  });
});

describe("sessionSize", () => {
  const plan = { sessionCap: 30, newLimit: 10 };

  it("fills the whole cap when both pools are deep", () => {
    expect(sessionSize(plan, { new: 300, due: 300 })).toBe(30);
  });

  // The case the dashboard used to lie about: a deck of nothing but new cards
  // serves the new share only, because there is no due backlog to fill the rest.
  it("serves only the new share when the deck is all new cards", () => {
    expect(sessionSize(plan, { new: 300, due: 0 })).toBe(10);
  });

  it("lets due fill the entire cap when no new cards remain", () => {
    expect(sessionSize(plan, { new: 0, due: 300 })).toBe(30);
  });

  it("serves nothing when the new share is spent and nothing is due", () => {
    expect(sessionSize({ sessionCap: 30, newLimit: 0 }, { new: 300, due: 0 })).toBe(0);
  });

  it("is bounded by thin pools on both sides", () => {
    expect(sessionSize(plan, { new: 3, due: 2 })).toBe(5);
  });

  // Ordering matters: buildQueue fetches new first and derives the due limit
  // from the rows it actually got. A model that sized due independently would
  // return 40 here.
  it("takes new first, leaving due only the rest of the cap", () => {
    expect(sessionSize(plan, { new: 100, due: 100 })).toBe(30);
  });

  it("gives the whole cap to due when the new pool falls short of its share", () => {
    // 4 new available against a share of 10 → 4 new + 26 due.
    expect(sessionSize(plan, { new: 4, due: 100 })).toBe(30);
  });

  it("is zero when the budget allows no session at all", () => {
    expect(sessionSize({ sessionCap: 0, newLimit: 0 }, { new: 300, due: 300 })).toBe(0);
  });
});
