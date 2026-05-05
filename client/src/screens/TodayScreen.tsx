import { useEffect, useState } from "react";
import { auth } from "../auth";
import { fetchQueue, fetchStreak } from "../api-hooks";

type Props = {
  onSignOut: () => void;
  onStartReview: () => void;
};

type State = {
  loading: boolean;
  due: number;
  newCount: number;
  streak: number;
  error: string | null;
};

export function TodayScreen({ onSignOut, onStartReview }: Props) {
  const [s, setS] = useState<State>({ loading: true, due: 0, newCount: 0, streak: 0, error: null });

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchQueue(), fetchStreak()])
      .then(([queue, streak]) => {
        if (cancelled) return;
        setS({
          loading: false,
          due: queue.due.length,
          newCount: queue.new.length,
          streak: streak.days,
          error: null,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setS((prev) => ({ ...prev, loading: false, error: err instanceof Error ? err.message : "load failed" }));
      });
    return () => { cancelled = true; };
  }, []);

  function signOut() {
    auth.clear();
    onSignOut();
  }

  const totalReady = s.due + s.newCount;

  return (
    <main className="screen">
      <header className="topbar">
        <h1>Today</h1>
        <button onClick={signOut} className="link">Sign out</button>
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
            <p className="muted center">All caught up — come back tomorrow.</p>
          )}
        </>
      )}
    </main>
  );
}
