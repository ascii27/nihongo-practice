import { useEffect, useState } from "react";
import { auth } from "../auth";
import { fetchGenerations, fetchSettingsStatus } from "../api-hooks";
import { GenerateForm } from "../components/GenerateForm";
import type { GenerationSummary } from "@nihongo/shared";

type Props = {
  onSignOut: () => void;
  onBack: () => void;
};

export function SettingsScreen({ onSignOut, onBack }: Props) {
  const [keyConfigured, setKeyConfigured] = useState<boolean | null>(null);
  const [generations, setGenerations] = useState<GenerationSummary[]>([]);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchSettingsStatus(), fetchGenerations(10)])
      .then(([status, gens]) => {
        if (cancelled) return;
        setKeyConfigured(status.ai_key_configured);
        setGenerations(gens.generations);
      })
      .catch(() => {
        if (cancelled) return;
        setKeyConfigured(false);
      });
    return () => { cancelled = true; };
  }, [refreshTick]);

  function signOut() {
    auth.clear();
    onSignOut();
  }

  return (
    <main className="screen settings-screen">
      <header className="topbar">
        <button onClick={onBack} className="link" aria-label="Back to Today">← Today</button>
        <h1>Settings</h1>
      </header>

      <section className="settings-section">
        <h2>AI key</h2>
        {keyConfigured === null ? (
          <p className="muted">Checking…</p>
        ) : keyConfigured ? (
          <p className="pill pill--ok">✓ Configured (set via .env)</p>
        ) : (
          <p className="pill pill--err">✗ Not configured</p>
        )}
      </section>

      <section className="settings-section">
        <GenerateForm mode="full" onSuccess={() => setRefreshTick((n) => n + 1)} />
      </section>

      <section className="settings-section">
        <h2>Recent generations</h2>
        {generations.length === 0 ? (
          <p className="muted">No generations yet.</p>
        ) : (
          <ul className="generations-list">
            {generations.map((g) => (
              <li key={g.id}>
                <span>{formatTimestamp(g.requested_at)}</span>
                <span>{g.count_inserted} cards</span>
                <span>${g.cost_usd.toFixed(2)}</span>
                <span aria-label={g.status}>
                  {g.status === "failed" ? "✗ failed" : g.status === "partial" ? "◐ partial" : "✓"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="settings-section">
        <button type="button" className="link" onClick={signOut}>Sign out</button>
      </section>
    </main>
  );
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${date}, ${time}`;
}
