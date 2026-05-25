import { useEffect, useMemo, useState } from "react";
import type { StatsOverviewResponse, StatsBySkillResponse } from "@nihongo/shared";
import { fetchStatsOverview, fetchStatsBySkill } from "../api-hooks";
import { SKILL_ORDER, SKILL_META } from "../lib/skills";

function calLevel(n: number | null): string {
  if (n == null || n === 0) return "";
  if (n < 15) return "l1";
  if (n < 25) return "l2";
  if (n < 35) return "l3";
  return "l4";
}

export function StatsScreen() {
  const [overview, setOverview] = useState<StatsOverviewResponse | null>(null);
  const [bySkill, setBySkill] = useState<StatsBySkillResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchStatsOverview(), fetchStatsBySkill()])
      .then(([o, b]) => { if (!cancelled) { setOverview(o); setBySkill(b); } })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "load failed"); });
    return () => { cancelled = true; };
  }, []);

  // 30 daily counts → 35-cell grid (5 rows × 7) padded at the front.
  const calCells = useMemo(() => {
    const daily = overview?.daily_reviews ?? [];
    const pad = Math.max(0, 35 - daily.length);
    return [...Array(pad).fill(null), ...daily] as (number | null)[];
  }, [overview]);

  if (error) return <main className="screen stats"><div className="stats__empty" role="alert">Couldn't load: {error}</div></main>;
  if (!overview || !bySkill) return <main className="screen screen--centered">Loading…</main>;

  const max = Math.max(...overview.daily_reviews, 1);
  const accPct = overview.overall_accuracy == null ? "—" : `${Math.round(overview.overall_accuracy * 100)}`;

  return (
    <main className="screen stats">
      <header className="topbar">
        <h1 className="topbar__title">Stats</h1>
      </header>

      <div className="stats__hero-grid">
        <div className="stats__hero-card">
          <div className="stats__hero-label">Streak</div>
          <div className="stats__hero-num">{overview.streak_days}</div>
          <div className="stats__hero-sub">longest {overview.longest_streak} days</div>
        </div>
        <div className="stats__hero-card">
          <div className="stats__hero-label">Accuracy</div>
          <div className="stats__hero-num">
            {accPct}{overview.overall_accuracy != null && <span style={{ fontSize: "0.5em" }}>%</span>}
          </div>
          <div className="stats__hero-sub">{overview.total_reviewed.toLocaleString()} reviews</div>
        </div>
      </div>

      <section className="stats__card">
        <h3 className="stats__card-title">Last 30 days</h3>
        <div className="stats__chart">
          {overview.daily_reviews.map((n, i) => {
            const h = (n / max) * 100;
            return (
              <div
                key={i}
                className={`stats__chart-bar ${n > 0 ? "is-active" : ""}`}
                style={{ height: `${Math.max(h, n > 0 ? 8 : 4)}%` }}
              />
            );
          })}
        </div>
        <div className="stats__chart-meta"><span>30d ago</span><span>today</span></div>
      </section>

      <section className="stats__card">
        <h3 className="stats__card-title">Streak calendar</h3>
        <div className="stats__cal">
          {calCells.map((n, i) => <div key={i} className={`stats__cal-day ${calLevel(n)}`} />)}
        </div>
        <div className="stats__chart-meta" style={{ marginTop: 10 }}><span>fewer</span><span>more</span></div>
      </section>

      <section className="stats__card">
        <h3 className="stats__card-title">Accuracy by skill</h3>
        {SKILL_ORDER.map((sk) => {
          const acc = bySkill.by_skill[sk].accuracy_30d;
          const pct = acc == null ? 0 : Math.round(acc * 100);
          return (
            <div key={sk} className="stats__accuracy-row">
              <span className="stats__accuracy-name">{SKILL_META[sk].label}</span>
              <div className="stats__accuracy-bar">
                <div className="stats__accuracy-bar-fill" style={{ width: `${pct}%` }} />
              </div>
              <span className="stats__accuracy-pct">{acc == null ? "—" : `${pct}%`}</span>
            </div>
          );
        })}
      </section>

      {overview.hardest_cards.length > 0 && (
        <section className="stats__card">
          <h3 className="stats__card-title">Hardest cards</h3>
          {overview.hardest_cards.map((c) => (
            <div key={c.id} className="stats__hard-row">
              <div>
                <div className="stats__hard-front">{c.front}</div>
                <div className="stats__hard-meaning">{c.meaning}</div>
              </div>
              <span className="stats__hard-pct">{Math.round(c.accuracy * 100)}%</span>
            </div>
          ))}
        </section>
      )}
    </main>
  );
}
