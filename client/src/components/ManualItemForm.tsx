import { useState } from "react";
import type { ManualVocabPreviewResponse } from "@nihongo/shared";
import { previewManualVocab, saveManualVocab } from "../api-hooks";
import { ApiError } from "../api";

type Phase =
  | { kind: "input" }
  | { kind: "translating" }
  | { kind: "preview"; preview: ManualVocabPreviewResponse; edited: Editable }
  | { kind: "saving"; edited: Editable }
  | { kind: "saved"; saved: Editable };

type Editable = {
  japanese: string;
  english: string;
  sentence_japanese: string;
  sentence_english: string;
};

type Props = {
  onSaved?: () => void;
};

// "Add a word" — two phases: type an EN/JA input, the AI fills in the missing
// side + an example sentence, the learner can tweak it, then save.
export function ManualItemForm({ onSaved }: Props) {
  const [input, setInput] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "input" });
  const [error, setError] = useState<string | null>(null);

  async function translate(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim()) return;
    setError(null);
    setPhase({ kind: "translating" });
    try {
      const preview = await previewManualVocab({ input: input.trim() });
      setPhase({
        kind: "preview",
        preview,
        edited: {
          japanese: preview.japanese,
          english: preview.english,
          sentence_japanese: preview.sentence_japanese,
          sentence_english: preview.sentence_english,
        },
      });
    } catch (err) {
      setError(messageOf(err));
      setPhase({ kind: "input" });
    }
  }

  async function save() {
    if (phase.kind !== "preview") return;
    setError(null);
    const { edited } = phase;
    setPhase({ kind: "saving", edited });
    try {
      await saveManualVocab(edited);
      setPhase({ kind: "saved", saved: edited });
      onSaved?.();
    } catch (err) {
      setError(messageOf(err));
      setPhase({ kind: "preview", preview: phase.preview, edited });
    }
  }

  function reset() {
    setInput("");
    setError(null);
    setPhase({ kind: "input" });
  }

  function updateField(field: keyof Editable, value: string) {
    if (phase.kind !== "preview") return;
    setPhase({ ...phase, edited: { ...phase.edited, [field]: value } });
  }

  if (phase.kind === "saved") {
    return (
      <div className="settings__gen">
        <p className="settings__gen-status is-ok">
          Added <strong className="jp">{phase.saved.japanese}</strong> · {phase.saved.english}
        </p>
        <button type="button" className="cta cta--block" onClick={reset}>Add another</button>
      </div>
    );
  }

  if (phase.kind === "preview" || phase.kind === "saving") {
    const isSaving = phase.kind === "saving";
    const edited = phase.edited;
    const cost = phase.kind === "preview" ? phase.preview.cost_usd : 0;
    return (
      <div className="settings__gen">
        <label className="settings__field">
          <span className="settings__field-label">Japanese</span>
          <input className="settings__input jp" value={edited.japanese}
            onChange={(e) => updateField("japanese", e.target.value)} disabled={isSaving} />
        </label>
        <label className="settings__field">
          <span className="settings__field-label">English</span>
          <input className="settings__input" value={edited.english}
            onChange={(e) => updateField("english", e.target.value)} disabled={isSaving} />
        </label>
        <label className="settings__field">
          <span className="settings__field-label">Example sentence (Japanese)</span>
          <input className="settings__input jp" value={edited.sentence_japanese}
            onChange={(e) => updateField("sentence_japanese", e.target.value)} disabled={isSaving} />
        </label>
        <label className="settings__field">
          <span className="settings__field-label">Example sentence (English)</span>
          <input className="settings__input" value={edited.sentence_english}
            onChange={(e) => updateField("sentence_english", e.target.value)} disabled={isSaving} />
        </label>
        <div className="manual__actions">
          <button type="button" className="cta" onClick={reset} disabled={isSaving}>Discard</button>
          <button type="button" className="cta cta--primary" onClick={save} disabled={isSaving || !allFilled(edited)}>
            {isSaving ? "Adding…" : `Add to deck${cost > 0 ? ` (${formatCost(cost)})` : ""}`}
          </button>
        </div>
        {error && <p role="alert" className="settings__gen-status is-err">{error}</p>}
      </div>
    );
  }

  const translating = phase.kind === "translating";
  return (
    <form className="settings__gen" onSubmit={translate}>
      <label className="settings__field">
        <span className="settings__field-label">Word or phrase (English or Japanese)</span>
        <input
          className="settings__input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="e.g. to forget,  約束,  see you tomorrow"
          maxLength={120}
          disabled={translating}
          autoComplete="off"
        />
      </label>
      <button type="submit" className="cta cta--primary cta--block" disabled={translating || !input.trim()}>
        {translating ? "Translating…" : "Translate"}
      </button>
      {error && <p role="alert" className="settings__gen-status is-err">{error}</p>}
    </form>
  );
}

function allFilled(e: Editable): boolean {
  return Boolean(e.japanese.trim() && e.english.trim() && e.sentence_japanese.trim() && e.sentence_english.trim());
}

function formatCost(cents: number): string {
  // computeCost returns dollars; cap display at the cent if anything.
  if (cents <= 0) return "free";
  return `~$${cents.toFixed(3)}`;
}

function messageOf(err: unknown): string {
  if (err instanceof ApiError) return err.message || `Request failed (${err.status})`;
  if (err instanceof Error) return err.message;
  return "Request failed";
}
