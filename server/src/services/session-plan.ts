import type { Focus } from "@nihongo/shared";

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

// Drill ("drill all anyway") deals every card in a focus. A tag is a
// hand-built set — a class list — so it is dealt whole; a skill alone can be
// thousands of cards, so it is sampled.
export const DRILL_UNTAGGED_CAP = 50;

export function drillLimit(focus: Focus): number | null {
  return focus.tag !== undefined ? null : DRILL_UNTAGGED_CAP;
}

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

  const newLimit = Math.max(0, Math.min(sessionCap, newShare(budget) - introducedToday));
  return { sessionCap, newLimit };
}

// New cards get a third of the target per round — at the default 30 that is
// the 10/day this app has always used. One share for the whole day, whichever
// tab introduces the cards.
function newShare(budget: { target: number; extra_rounds: number }): number {
  return Math.round(budget.target / 3) * (1 + budget.extra_rounds);
}

// The SRS tab reviews the whole deck on the Leitner schedule: every due card,
// with no focus and no daily target. It is still a session someone has to sit
// through on a phone, so one sitting deals at most this many; whatever is left
// is still due afterwards and the hero offers it again.
export const SRS_SESSION_CAP = 200;

export type SrsPlan = { due: number; new: number };

// How many due and new cards an SRS session deals. Due comes first — that is
// what the schedule says you are about to forget — and new cards fill what is
// left of the cap, up to what remains of today's new-card share (the same share
// the Daily tab draws on, so switching tabs can't double the day's new cards).
//
// Pure, like `sessionSize`: `buildSrsQueue` fetches exactly these counts and
// the dashboard shows their sum, so the SRS hero can't promise a different
// session than the one it starts.
export function planSrs(
  budget: { target: number; extra_rounds: number },
  introducedToday: number,
  available: { new: number; due: number },
): SrsPlan {
  const due = Math.min(SRS_SESSION_CAP, available.due);
  const newLeft = Math.max(0, newShare(budget) - introducedToday);
  const neu = Math.min(newLeft, available.new, SRS_SESSION_CAP - due);
  return { due, new: neu };
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
