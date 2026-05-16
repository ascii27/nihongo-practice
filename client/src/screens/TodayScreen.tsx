import { useCallback, useEffect, useState } from "react";
import { fetchQueue, fetchStreak } from "../api-hooks";
import { GenerateForm } from "../components/GenerateForm";

type Props = {
  onStartReview: () => void;
  onOpenSettings: () => void;
};

type State = {
  loading: boolean;
  due: number;
  newCount: number;
  streak: number;
  error: string | null;
};

export function TodayScreen({ onStartReview, onOpenSettings }: Props) {
  const [s, setS] = useState<State>({ loading: true, due: 0, newCount: 0, streak: 0, error: null });

  const load = useCallback(() => {
    Promise.all([fetchQueue(), fetchStreak()])
      .then(([queue, streak]) => {
        setS({
          loading: false,
          due: queue.due.length,
          newCount: queue.new.length,
          streak: streak.days,
          error: null,
        });
      })
      .catch((err) => {
        setS((prev) => ({ ...prev, loading: false, error: err instanceof Error ? err.message : "load failed" }));
      });
  }, []);

  useEffect(() => { load(); }, [load]);

  const totalReady = s.due + s.newCount;

  return (
    <main className="screen">
      <header className="topbar">
        <h1>Today</h1>
        <button onClick={onOpenSettings} className="link">Settings</button>
      </header>

      {s.loading ? (
        <section className="hero"><p>Loading…</p></section>
      ) : s.error ? (
        <section className="hero"><p role="alert">Couldn't load: {s.error}</p></section>
      ) : (
        <>
          <section className="hero">
            <p className="big-number">{totalReady}</p>
            <p>cards ready</p>
            <p className="muted">
              {s.due} due · {s.newCount} new · {s.streak}-day streak
            </p>
          </section>

          {totalReady > 0 ? (
            <button type="button" className="cta" onClick={onStartReview}>
              Start review
            </button>
          ) : (
            <section className="empty-state">
              <p className="center">✓ All caught up</p>
              <GenerateForm mode="compact" onSuccess={load} />
            </section>
          )}
        </>
      )}
    </main>
  );
}
