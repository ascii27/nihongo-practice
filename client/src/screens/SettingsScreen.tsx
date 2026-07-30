import { useEffect, useState } from "react";
import { auth } from "../auth";
import { fetchGenerations, fetchSettingsStatus, updateDailyTarget } from "../api-hooks";
import { GenerateForm } from "../components/GenerateForm";
import { ManualItemForm } from "../components/ManualItemForm";
import { IconChevron } from "../components/icons";
import type { GenerationSummary } from "@nihongo/shared";

type Props = {
  onSignOut: () => void;
  onBack: () => void;
};

export function SettingsScreen({ onSignOut, onBack }: Props) {
  const [keyConfigured, setKeyConfigured] = useState<boolean | null>(null);
  const [generations, setGenerations] = useState<GenerationSummary[]>([]);
  const [refreshTick, setRefreshTick] = useState(0);
  const [target, setTarget] = useState<number | null>(null);
  const [targetError, setTargetError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchSettingsStatus(), fetchGenerations(10)])
      .then(([status, gens]) => {
        if (cancelled) return;
        setKeyConfigured(status.ai_key_configured);
        setTarget(status.daily_review_target);
        setGenerations(gens.generations);
      })
      .catch(() => { if (!cancelled) setKeyConfigured(false); });
    return () => { cancelled = true; };
  }, [refreshTick]);

  function signOut() {
    auth.clear();
    onSignOut();
  }

  // Optimistic: the number moves immediately, and reverts if the PATCH fails.
  function stepTarget(delta: number) {
    if (target === null) return;
    const next = Math.min(100, Math.max(10, target + delta));
    if (next === target) return;
    const prevTarget = target;
    setTarget(next);
    setTargetError(null);
    updateDailyTarget(next).catch(() => {
      setTarget(prevTarget);
      setTargetError("Couldn't save — try again.");
    });
  }

  return (
    <main className="screen screen--flush settings">
      <header className="topbar">
        <button type="button" className="topbar__back" onClick={onBack} aria-label="Back to Today">
          <IconChevron className="topbar__back-chev" /> Today
        </button>
        <h1 className="topbar__title" style={{ fontSize: 17 }}>Settings</h1>
        <span style={{ width: 44 }} />
      </header>

      <div className="settings__section">
        <h2 className="settings__section-title">Account</h2>
        <div className="settings__list">
          <div className="settings__row">
            <span className="settings__row-label">AI key</span>
            {keyConfigured === null ? (
              <span className="muted">Checking…</span>
            ) : keyConfigured ? (
              <span className="settings__pill settings__pill--ok">✓ Configured</span>
            ) : (
              <span className="settings__pill settings__pill--err">✗ Not set</span>
            )}
          </div>
        </div>
      </div>

      <div className="settings__section">
        <h2 className="settings__section-title">Practice</h2>
        <div className="settings__list">
          <div className="settings__row settings__row--stacked">
            <span className="settings__row-label">
              Daily review target
              <span className="settings__row-hint">
                Cards per day before you're done. Steps of 10.
              </span>
              {targetError && <span className="settings__row-hint" role="alert">{targetError}</span>}
            </span>
            {target === null ? (
              <span className="muted">Checking…</span>
            ) : (
              <div className="settings__stepper">
                <button
                  type="button" className="settings__stepper-btn"
                  onClick={() => stepTarget(-10)} disabled={target <= 10}
                  aria-label="Decrease daily review target"
                >−</button>
                <span className="settings__stepper-value" aria-live="polite">{target}</span>
                <button
                  type="button" className="settings__stepper-btn"
                  onClick={() => stepTarget(10)} disabled={target >= 100}
                  aria-label="Increase daily review target"
                >+</button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="settings__section">
        <h2 className="settings__section-title">Add a word</h2>
        <ManualItemForm onSaved={() => setRefreshTick((n) => n + 1)} />
      </div>

      <div className="settings__section">
        <h2 className="settings__section-title">Generate new cards</h2>
        <GenerateForm mode="full" onSuccess={() => setRefreshTick((n) => n + 1)} />
      </div>

      <div className="settings__section">
        <h2 className="settings__section-title">Recent generations</h2>
        {generations.length === 0 ? (
          <p className="settings__empty">No generations yet.</p>
        ) : (
          <div className="settings__gens-list">
            {generations.map((g) => {
              const statusGlyph = g.status === "failed" ? "✗" : g.status === "partial" ? "◐" : "✓";
              return (
                <div key={g.id} className="settings__gen-item">
                  <div>
                    <div className="settings__gen-item-date">{formatDate(g.requested_at)}</div>
                    <div className="settings__gen-item-meta">
                      {g.skill} · {g.count_inserted} cards · ${g.cost_usd.toFixed(2)}
                    </div>
                  </div>
                  <span className={`settings__gen-item-status is-${g.status}`} aria-hidden>{statusGlyph}</span>
                  <span className="settings__gen-item-meta" aria-label={`status ${g.status}`}>{g.status}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <button type="button" className="settings__signout" onClick={signOut}>Sign out</button>
    </main>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
