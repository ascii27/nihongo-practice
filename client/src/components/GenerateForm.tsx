import { useState } from "react";
import type { Skill } from "@nihongo/shared";
import { generateItems } from "../api-hooks";
import { ApiError } from "../api";

type Mode = "full" | "compact";
type Status =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success"; inserted: number; requested: number; cost_usd: number }
  | { kind: "failed"; message: string };

type Props = {
  mode: Mode;
  defaultCount?: number;
  defaultSkill?: Skill;
  lockedSkill?: Skill;          // if set, the skill picker is hidden + forced
  onSuccess?: () => void;
};

const SKILL_LABELS: Record<Skill, string> = {
  vocab: "Vocabulary",
  grammar: "Grammar",
  reading: "Reading",
  conjugation: "Conjugation",
  particle: "Particles",
  explain: "Explain",
};

export function GenerateForm({ mode, defaultCount = 10, defaultSkill = "vocab", lockedSkill, onSuccess }: Props) {
  const [skill, setSkill] = useState<Skill>(lockedSkill ?? defaultSkill);
  const [count, setCount] = useState(defaultCount);
  const [hint, setHint] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const estimatedCents = Math.max(1, Math.ceil(count * 0.001 * 100));
  const estimateLabel = `~$0.${estimatedCents.toString().padStart(2, "0")}`;
  const submitting = status.kind === "submitting";
  const buttonLabel = submitting
    ? "Generating…"
    : `Generate ${count} ${SKILL_LABELS[skill].toLowerCase()} (${estimateLabel})`;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus({ kind: "submitting" });
    try {
      const r = await generateItems({
        skill,
        count,
        weakness_hint: mode === "full" && hint.trim() ? hint.trim() : undefined,
      });
      setStatus({ kind: "success", inserted: r.items_created, requested: count, cost_usd: r.cost_usd });
      onSuccess?.();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : err instanceof Error ? err.message : "request failed";
      setStatus({ kind: "failed", message });
    }
  }

  return (
    <form className={`settings__gen generate-form generate-form--${mode}`} onSubmit={submit}>
      <div className="settings__gen-row">
        {!lockedSkill ? (
          <label className="settings__field">
            <span className="settings__field-label">Skill</span>
            <select className="settings__select" value={skill} onChange={(e) => setSkill(e.target.value as Skill)} disabled={submitting}>
              {(Object.keys(SKILL_LABELS) as Skill[]).map((s) => (
                <option key={s} value={s}>{SKILL_LABELS[s]}</option>
              ))}
            </select>
          </label>
        ) : (
          <span />
        )}
        <label className="settings__field">
          <span className="settings__field-label">Count</span>
          <input
            className="settings__input"
            type="number"
            min={1}
            max={50}
            value={count}
            onChange={(e) => setCount(Math.min(50, Math.max(1, Number(e.target.value) || 1)))}
            disabled={submitting}
          />
        </label>
      </div>

      {mode === "full" && (
        <label className="settings__field">
          <span className="settings__field-label">Focus area (optional)</span>
          <input
            className="settings__input"
            placeholder="e.g. verbs for cooking"
            maxLength={200}
            value={hint}
            onChange={(e) => setHint(e.target.value)}
            disabled={submitting}
          />
        </label>
      )}

      <button type="submit" className="cta cta--primary cta--block" disabled={submitting}>{buttonLabel}</button>

      {status.kind === "success" && (
        <p role="status" className="settings__gen-status is-ok">
          {status.inserted < status.requested
            ? `Added ${status.inserted} of ${status.requested} cards · $${status.cost_usd.toFixed(2)}`
            : `Added ${status.inserted} cards · $${status.cost_usd.toFixed(2)}`}
        </p>
      )}
      {status.kind === "failed" && (
        <p role="alert" className="settings__gen-status is-err">Generation failed — try again</p>
      )}
    </form>
  );
}
