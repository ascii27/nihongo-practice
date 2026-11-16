import { useState, type ReactNode } from "react";
import type { QuickAddItemRequest } from "@nihongo/shared";
import { previewQuickAdd } from "../api-hooks";
import { SKILL_META } from "../lib/skills";

export type QuickKind = "vocab" | "kanji" | "grammar";
export const QUICK_KINDS: readonly QuickKind[] = ["vocab", "kanji", "grammar"];
export function isQuickKind(s: string | undefined): s is QuickKind {
  return s === "vocab" || s === "kanji" || s === "grammar";
}

type Props = {
  initialKind?: QuickKind;
  // Rendered under the type picker in every phase, e.g. Today's tag picker.
  extra?: ReactNode;
  saveLabel: string;
  save: (body: QuickAddItemRequest) => Promise<void>;
  addedNote: (label: string) => string;
  onAdded?: () => void | Promise<void>;
};

// Quick-add one card: pick a type, type a word / kanji / grammar pattern, get
// an editable draft (AI for vocab and grammar, the kanji table for kanji), then
// save. Where it saves is the caller's: a tag in Library's sheet, the deck
// (optionally tagged) on Today.
type QuickPhase = "input" | "loading" | "preview" | "saving";
type EditFields = Record<string, string>;

const KIND_INPUT: Record<QuickKind, { label: string; placeholder: string }> = {
  vocab: { label: "a word", placeholder: "Word — English or Japanese (e.g. school / 学校)" },
  kanji: { label: "a kanji", placeholder: "Kanji (e.g. 食)" },
  grammar: { label: "a grammar point", placeholder: "Pattern (e.g. 〜てから)" },
};

export function QuickAddForm({ initialKind = "vocab", extra, saveLabel, save: saveCard, addedNote, onAdded }: Props) {
  const [kind, setKind] = useState<QuickKind>(initialKind);
  const [phase, setPhase] = useState<QuickPhase>("input");
  const [input, setInput] = useState("");
  const [fields, setFields] = useState<EditFields>({});
  const [readings, setReadings] = useState("");   // kanji only, display-only
  const [error, setError] = useState<string | null>(null);
  // The new card lands in the list behind this sheet, out of sight. Name what
  // was added instead of adding it silently.
  const [added, setAdded] = useState<string | null>(null);

  function restart() {
    setPhase("input");
    setInput("");
    setFields({});
    setReadings("");
    setError(null);
  }

  function setField(key: string, value: string) {
    setFields((f) => ({ ...f, [key]: value }));
  }

  // Step 1: generate an editable draft from the raw input.
  async function generate(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim()) return;
    setPhase("loading");
    setError(null);
    setAdded(null);
    try {
      const p = await previewQuickAdd({ kind, input: input.trim() });
      if (p.kind === "vocab") {
        setFields({ japanese: p.japanese, english: p.english, sentence_japanese: p.sentence_japanese, sentence_english: p.sentence_english });
      } else if (p.kind === "grammar") {
        setFields({ pattern: p.pattern, explanation: p.explanation, sentence_japanese: p.sentence_japanese, sentence_english: p.sentence_english });
      } else {
        setFields({ character: p.character, meaning: p.meaning });
        setReadings(p.readings);
      }
      setPhase("preview");
    } catch (err) {
      setError(err instanceof Error ? err.message : "generation failed");
      setPhase("input");
    }
  }

  // Step 2: save the (edited) draft.
  async function save() {
    setPhase("saving");
    try {
      const f = (k: string) => (fields[k] ?? "").trim();
      let body: QuickAddItemRequest;
      if (kind === "vocab") {
        body = { kind, japanese: f("japanese"), english: f("english"), sentence_japanese: f("sentence_japanese"), sentence_english: f("sentence_english") };
      } else if (kind === "grammar") {
        body = { kind, pattern: f("pattern"), explanation: f("explanation"), sentence_japanese: f("sentence_japanese"), sentence_english: f("sentence_english") };
      } else {
        body = { kind, character: f("character"), meaning: f("meaning") };
      }
      await saveCard(body);
      const label = kind === "vocab" ? f("japanese") : kind === "grammar" ? f("pattern") : f("character");
      restart();
      setAdded(label);
      await onAdded?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "save failed");
      setPhase("preview");
    }
  }

  const kinds = (
    <>
    <div className="study-quick__kinds" role="tablist" aria-label="Card type">
      {QUICK_KINDS.map((k) => (
        <button key={k} type="button" role="tab" aria-selected={kind === k}
                className={`study-quick__kind ${kind === k ? "is-active" : ""}`}
                onClick={() => { setKind(k); restart(); }}>
          {SKILL_META[k].label}
        </button>
      ))}
    </div>
    {extra}
    </>
  );

  if (phase === "preview" || phase === "saving") {
    const saving = phase === "saving";
    return (
      <div className="study-quick">
        {kinds}
        <p className="study-quick__note">Review and edit, then add.</p>
        {kind === "vocab" && (
          <>
            <Labeled label="Japanese"><input className="settings__input jp" value={fields.japanese ?? ""} onChange={(e) => setField("japanese", e.target.value)} maxLength={120} /></Labeled>
            <Labeled label="English"><input className="settings__input" value={fields.english ?? ""} onChange={(e) => setField("english", e.target.value)} maxLength={120} /></Labeled>
            <Labeled label="Example sentence"><input className="settings__input jp" value={fields.sentence_japanese ?? ""} onChange={(e) => setField("sentence_japanese", e.target.value)} maxLength={200} /></Labeled>
            <Labeled label="Sentence translation"><input className="settings__input" value={fields.sentence_english ?? ""} onChange={(e) => setField("sentence_english", e.target.value)} maxLength={200} /></Labeled>
          </>
        )}
        {kind === "grammar" && (
          <>
            <Labeled label="Pattern"><input className="settings__input jp" value={fields.pattern ?? ""} onChange={(e) => setField("pattern", e.target.value)} maxLength={120} /></Labeled>
            <Labeled label="Explanation"><input className="settings__input" value={fields.explanation ?? ""} onChange={(e) => setField("explanation", e.target.value)} maxLength={400} /></Labeled>
            <Labeled label="Example sentence"><input className="settings__input jp" value={fields.sentence_japanese ?? ""} onChange={(e) => setField("sentence_japanese", e.target.value)} maxLength={200} /></Labeled>
            <Labeled label="Sentence translation"><input className="settings__input" value={fields.sentence_english ?? ""} onChange={(e) => setField("sentence_english", e.target.value)} maxLength={200} /></Labeled>
          </>
        )}
        {kind === "kanji" && (
          <>
            <p className="kanji-card__glyph" style={{ fontSize: 56, margin: "4px 0" }}>{fields.character}</p>
            <Labeled label="Meaning"><input className="settings__input" value={fields.meaning ?? ""} onChange={(e) => setField("meaning", e.target.value)} maxLength={200} /></Labeled>
            {readings ? <p className="kanji-draw__reading" style={{ textAlign: "left" }}>{readings}</p>
              : <p className="muted" style={{ fontSize: 12 }}>Not in the kanji library — add a meaning above.</p>}
          </>
        )}
        {error && <p className="muted" role="alert" style={{ color: "var(--error)" }}>{error}</p>}
        <button type="button" className="cta cta--primary cta--block" onClick={save} disabled={saving}>
          {saving ? "Adding…" : saveLabel}
        </button>
        <button type="button" className="linkbtn" onClick={restart} disabled={saving}>Start over</button>
      </div>
    );
  }

  // input / loading
  return (
    <form className="study-quick" onSubmit={generate}>
      {kinds}
      <input className="settings__input" placeholder={KIND_INPUT[kind].placeholder} value={input}
             onChange={(e) => setInput(e.target.value)} maxLength={200} disabled={phase === "loading"} />
      {added && <p className="study-quick__note" role="status">{addedNote(added)}</p>}
      {error && <p className="muted" role="alert" style={{ color: "var(--error)" }}>{error}</p>}
      <button type="submit" className="cta cta--primary cta--block" disabled={phase === "loading" || !input.trim()}>
        {phase === "loading" ? "Generating…" : "Generate"}
      </button>
    </form>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="settings__field">
      <span className="settings__field-label">{label}</span>
      {children}
    </label>
  );
}
