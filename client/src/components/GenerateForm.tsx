import { useState } from "react";
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
  onSuccess?: () => void;
};

export function GenerateForm({ mode, defaultCount = 10, onSuccess }: Props) {
  const [count, setCount] = useState(defaultCount);
  const [hint, setHint] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const estimatedCents = Math.max(1, Math.ceil(count * 0.001 * 100));
  const estimateLabel = `~$0.${estimatedCents.toString().padStart(2, "0")}`;
  const buttonLabel = status.kind === "submitting"
    ? "Generating…"
    : `Generate ${count} vocab (${estimateLabel})`;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus({ kind: "submitting" });
    try {
      const r = await generateItems({
        skill: "vocab",
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

  const submitting = status.kind === "submitting";

  return (
    <form className={`generate-form generate-form--${mode}`} onSubmit={submit}>
      {mode === "full" && <h2>Generate vocab</h2>}

      <label className="generate-form__count">
        <span>Count</span>
        <input
          type="number"
          min={1}
          max={50}
          value={count}
          onChange={(e) => setCount(Math.min(50, Math.max(1, Number(e.target.value) || 1)))}
          disabled={submitting}
        />
      </label>

      {mode === "full" && (
        <label className="generate-form__hint">
          <span>Focus area (optional)</span>
          <textarea
            placeholder="e.g., verbs for cooking"
            maxLength={200}
            rows={2}
            value={hint}
            onChange={(e) => setHint(e.target.value)}
            disabled={submitting}
          />
        </label>
      )}

      <button type="submit" disabled={submitting}>
        {buttonLabel}
      </button>

      {status.kind === "success" && (
        <p role="status" className="generate-form__status">
          {status.inserted < status.requested
            ? `Added ${status.inserted} of ${status.requested} cards · $${status.cost_usd.toFixed(2)}`
            : `Added ${status.inserted} cards · $${status.cost_usd.toFixed(2)}`}
        </p>
      )}
      {status.kind === "failed" && (
        <p role="alert" className="generate-form__status generate-form__status--error">
          Generation failed — try again
        </p>
      )}
    </form>
  );
}
