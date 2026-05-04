import { auth } from "../auth";

export function TodayScreen({ onSignOut }: { onSignOut: () => void }) {
  function signOut() {
    auth.clear();
    onSignOut();
  }
  return (
    <main className="screen">
      <header className="topbar">
        <h1>Today</h1>
        <button onClick={signOut} className="link">Sign out</button>
      </header>
      <section className="hero">
        <p className="big-number">0</p>
        <p>cards due</p>
      </section>
      <p className="muted">The review loop ships in Phase 1.</p>
    </main>
  );
}
