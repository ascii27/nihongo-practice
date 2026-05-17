import { useCallback, useEffect, useState } from "react";
import type { DashboardResponse, Skill } from "@nihongo/shared";
import { fetchDashboard } from "../api-hooks";
import { SkillCard } from "../components/SkillCard";

const SKILL_ORDER: Skill[] = ["vocab", "grammar", "particle", "conjugation", "reading"];
const AVAILABLE: Skill[] = ["vocab", "grammar", "particle", "conjugation"];

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
    <main className="screen dashboard">
      <header className="topbar">
        <h1>Today</h1>
        <button onClick={onOpenSettings} className="link">Settings</button>
      </header>

      <p className="dashboard__streak muted">
        {data.streak_days}-day streak · last practice {lastLabel}
      </p>

      <section className={`dashboard__mixed ${totalDue === 0 ? "is-empty" : ""}`}>
        {totalDue > 0 ? (
          <>
            <p className="dashboard__mixed-count">{totalDue}</p>
            <p className="muted">cards ready across all skills</p>
            <button type="button" className="cta cta--primary" onClick={() => onPractice(undefined)}>
              Start mixed practice →
            </button>
          </>
        ) : (
          <p>All caught up — pick a skill to generate more.</p>
        )}
      </section>

      <h2 className="dashboard__heading">Skills</h2>
      <section className="dashboard__skills">
        {SKILL_ORDER.map((s) => (
          <SkillCard
            key={s}
            skill={s}
            due={data.by_skill[s].due}
            newCount={data.by_skill[s].new}
            available={AVAILABLE.includes(s)}
            onPractice={() => onPractice(s)}
            onGenerated={load}
          />
        ))}
      </section>
    </main>
  );
}
