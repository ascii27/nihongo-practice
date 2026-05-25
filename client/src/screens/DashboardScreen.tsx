import { useCallback, useEffect, useState } from "react";
import type { DashboardResponse, Skill } from "@nihongo/shared";
import { fetchDashboard } from "../api-hooks";
import { SKILL_ORDER, SKILL_META } from "../lib/skills";
import { IconChevron } from "../components/icons";

type Props = {
  onPractice: (skill?: Skill) => void;   // undefined = mixed
  onOpenSettings: () => void;
};

export function DashboardScreen({ onPractice, onOpenSettings }: Props) {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchDashboard()
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : "load failed"));
  }, []);

  useEffect(() => { load(); }, [load]);

  if (error) return <main className="screen"><p role="alert">Couldn't load: {error}</p></main>;
  if (!data) return <main className="screen screen--centered">Loading…</main>;

  const totalDue = SKILL_ORDER.reduce((acc, s) => acc + data.by_skill[s].due + data.by_skill[s].new, 0);
  const lastLabel = data.last_practiced_at
    ? new Date(data.last_practiced_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : "never";

  return (
    <main className="screen today">
      <header className="topbar">
        <h1 className="topbar__title">Today</h1>
        <button type="button" className="topbar__action" onClick={onOpenSettings}>Settings</button>
      </header>

      <div className="today__streak">
        <span className="today__streak-flame">日</span>
        <span><span className="today__streak-num">{data.streak_days}</span>-day streak</span>
        <span className="today__streak-sep">·</span>
        <span>last practice {lastLabel}</span>
      </div>

      <section className="today__hero">
        <p className="today__hero-label">Ready to review</p>
        <p className="today__hero-count">{totalDue}</p>
        {totalDue > 0 ? (
          <>
            <p className="today__hero-sub">cards across all skills &nbsp;·&nbsp; <span className="jp">混合練習</span></p>
            <button type="button" className="cta cta--primary cta--lg today__hero-cta" onClick={() => onPractice(undefined)}>
              Start mixed practice
            </button>
          </>
        ) : (
          <p className="today__hero-empty">全部終わり — all caught up. Generate more in Settings.</p>
        )}
      </section>

      <h2 className="today__section-title">Skills</h2>
      <div className="today__skill-list">
        {SKILL_ORDER.map((s) => {
          const { due, new: n } = data.by_skill[s];
          const total = due + n;
          const meta = SKILL_META[s];
          return (
            <button key={s} type="button" className={`today__skill-row skill-card--${s}`} onClick={() => onPractice(s)}>
              <span className="today__skill-glyph">{meta.short}</span>
              <span className="today__skill-meta">
                <span className="today__skill-name">{meta.label}</span>
                <span className="today__skill-counts">
                  {total > 0 ? <>{due} due · {n} new</> : <span className="empty">all caught up</span>}
                </span>
              </span>
              <span className={`today__skill-num ${total === 0 ? "is-zero" : ""}`}>{total}</span>
              <span className="today__skill-chev"><IconChevron /></span>
            </button>
          );
        })}
      </div>
    </main>
  );
}
