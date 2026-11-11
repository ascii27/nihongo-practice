import { useEffect, useState } from "react";
import type { LibraryItem, QuickAddItemRequest } from "@nihongo/shared";
import { tagItem, quickAddToTag, previewQuickAdd, searchTagCandidates } from "../api-hooks";
import { SKILL_META } from "../lib/skills";
import { IconClose } from "./icons";

type AddMode = "search" | "quick";
type QuickKind = "vocab" | "kanji" | "grammar";

type Props = {
  tagId: string;
  tagName: string;
  onChanged: () => Promise<void>;
  onClose: () => void;
};

// Adding cards to a tag, as a sheet over Library so the card list behind it
// keeps its fixed layout: search existing cards, or quick-add a new one with an
// AI-drafted (editable) translation and example.
export function AddCards({ tagId, tagName, onChanged, onClose }: Props) {
  const [mode, setMode] = useState<AddMode>("search");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-label="Add cards" onClick={onClose}>
      <div className="sheet__panel" onClick={(e) => e.stopPropagation()}>
        <div className="sheet__bar">
          <span className="sheet__kicker">Add cards to {tagName}</span>
          <button type="button" className="practice-bar__close" onClick={onClose} aria-label="Close add cards">
            <IconClose />
          </button>
        </div>
        <div className="lessons__mode-toggle" role="tablist" aria-label="Add cards">
          <button type="button" role="tab" aria-selected={mode === "search"}
                  className={`lessons__mode-btn ${mode === "search" ? "is-active" : ""}`}
                  onClick={() => setMode("search")}>
            Search &amp; add
          </button>
          <button type="button" role="tab" aria-selected={mode === "quick"}
                  className={`lessons__mode-btn ${mode === "quick" ? "is-active" : ""}`}
                  onClick={() => setMode("quick")}>
            Quick-add new
          </button>
        </div>
        {mode === "search"
          ? <SearchAdd tagId={tagId} onChanged={onChanged} />
          : <QuickAdd tagId={tagId} onChanged={onChanged} />}
      </div>
    </div>
  );
}

function SearchAdd({ tagId, onChanged }: { tagId: string; onChanged: () => Promise<void> }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<LibraryItem[]>([]);
  const [busy, setBusy] = useState(false);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    if (!q.trim()) return;
    setBusy(true);
    try {
      const r = await searchTagCandidates(tagId, q.trim());
      setResults(r.items);
    } finally {
      setBusy(false);
    }
  }

  async function add(itemId: string) {
    await tagItem(tagId, itemId);
    setResults((rs) => rs.filter((r) => r.id !== itemId));
    await onChanged();
  }

  return (
    <form className="study-search" onSubmit={run}>
      <div className="study-search__row">
        <input className="settings__input" placeholder="Search your cards…" value={q}
               onChange={(e) => setQ(e.target.value)} />
        <button type="submit" className="cta" disabled={busy || !q.trim()}>Search</button>
      </div>
      <ul className="study-detail__items">
        {results.map((it) => (
          <li key={it.id} className="study-item">
            <span className="study-item__chip">{SKILL_META[it.skill]?.short ?? "?"}</span>
            <span className="study-item__body">
              <span className="study-item__front">{it.front}</span>
              <span className="study-item__meaning">{it.meaning}</span>
            </span>
            <button type="button" className="study-item__add" onClick={() => add(it.id)}>Add</button>
          </li>
        ))}
        {q.trim() && !busy && results.length === 0 && <li className="muted study__empty">No matches.</li>}
      </ul>
    </form>
  );
}

type QuickPhase = "input" | "loading" | "preview" | "saving";
type EditFields = Record<string, string>;

const KIND_INPUT: Record<QuickKind, { label: string; placeholder: string }> = {
  vocab: { label: "a word", placeholder: "Word — English or Japanese (e.g. school / 学校)" },
  kanji: { label: "a kanji", placeholder: "Kanji (e.g. 食)" },
  grammar: { label: "a grammar point", placeholder: "Pattern (e.g. 〜てから)" },
};

function QuickAdd({ tagId, onChanged }: { tagId: string; onChanged: () => Promise<void> }) {
  const [kind, setKind] = useState<QuickKind>("vocab");
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
      await quickAddToTag(tagId, body);
      const label = kind === "vocab" ? f("japanese") : kind === "grammar" ? f("pattern") : f("character");
      restart();
      setAdded(label);
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "save failed");
      setPhase("preview");
    }
  }

  const kinds = (
    <div className="study-quick__kinds" role="tablist" aria-label="Card type">
      {(["vocab", "kanji", "grammar"] as QuickKind[]).map((k) => (
        <button key={k} type="button" role="tab" aria-selected={kind === k}
                className={`study-quick__kind ${kind === k ? "is-active" : ""}`}
                onClick={() => { setKind(k); restart(); }}>
          {SKILL_META[k].label}
        </button>
      ))}
    </div>
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
          {saving ? "Adding…" : "Add to tag"}
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
      {added && <p className="study-quick__note" role="status">Added {added} to this tag.</p>}
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
