// How big the next practice session is, and what it is made of.
//
// This arithmetic lives apart from `buildQueue` because two callers need it and
// they must not drift: the queue uses it to size the session it serves, and the
// dashboard uses it to decide the number on the hero. When they disagreed, the
// hero promised cards the session then refused to deal — the exact complaint the
// daily target was built to fix.
//
// Pure and db-free on purpose: the counts come from the caller.

// The limit `GET /api/queue` applies when the client sends none, which is what
// mixed practice does. The dashboard has to model the same session the client
// will actually ask for, so both read it from here.
export const DEFAULT_QUEUE_LIMIT = 100;

// Free practice — tapping a skill row on Today — is a fixed, modest session
// rather than a budget-derived one. It answers "let me drill this for a bit",
// so it wants a predictable length, not one that shrinks as the day fills up.
export const FREE_PRACTICE_SIZE = 20;

export type SessionPlan = {
  sessionCap: number;  // total cards this session may serve
  newLimit: number;    // of those, how many may be brand-new
};

export function planSession(
  budget: { target: number; extra_rounds: number; remaining: number },
  introducedToday: number,
  limit: number,
): SessionPlan {
  const sessionCap = Math.min(limit, budget.remaining);
  if (sessionCap <= 0) return { sessionCap: 0, newLimit: 0 };

  // New cards get a third of the target per round — at the default 30 that is
  // the 10/day this app has always used.
  const newShare = Math.round(budget.target / 3) * (1 + budget.extra_rounds);
  const newLimit = Math.max(0, Math.min(sessionCap, newShare - introducedToday));
  return { sessionCap, newLimit };
}

// How many cards the plan actually yields against the pools on hand.
//
// Mirrors `buildQueue`'s ordering rather than an idealized version: new cards
// are taken first, and due gets only what is left of the cap after the new rows
// that really existed. Sizing the two independently would over-promise whenever
// one pool is thin — which is precisely when the hero used to lie.
export function sessionSize(
  plan: SessionPlan,
  available: { new: number; due: number },
): number {
  const neu = Math.min(plan.newLimit, available.new);
  const due = Math.min(Math.max(0, plan.sessionCap - neu), available.due);
  return neu + due;
}
