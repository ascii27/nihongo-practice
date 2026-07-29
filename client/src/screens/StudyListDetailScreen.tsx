import { useEffect, useState } from "react";
import type { StudyListDetail, LibraryItem, QuickAddStudyItemRequest } from "@nihongo/shared";
import {
  fetchStudyList, addStudyItem, removeStudyItem, quickAddStudyItem, previewStudyItem,
  searchStudyCandidates, deleteStudyList,
} from "../api-hooks";
import { SKILL_META } from "../lib/skills";
import { IconClose } from "../components/icons";

type Props = {
  listId: string;
  onBack: () => void;
  onCram: (listId: string) => void;
  onDeleted: () => void;
};

type AddMode = "search" | "quick";
type QuickKind = "vocab" | "kanji" | "grammar";

export function StudyListDetailScreen({ listId, onBack, onCram, onDeleted }: Props) {
  const [detail, setDetail] = useState<StudyListDetail | null>(null);
  const [addMode, setAddMode] = useState<AddMode>("search");

  async function refresh() {
    setDetail(await fetchStudyList(listId));
  }
  useEffect(() => { void refresh(); }, [listId]);

  async function onRemove(itemId: string) {
    await removeStudyItem(listId, itemId);
    await refresh();
  }

  async function onDelete() {
    await deleteStudyList(listId);
    onDeleted();
  }

  const header = (title: string) => (
    <div className="study-detail__bar">
      <button type="button" className="practice-bar__close" onClick={onBack} aria-label="Back to lists">
        <IconClose />
      </button>
      <h1 className="study-detail__bar-title">{title}</h1>
      <span className="study-detail__bar-spacer" aria-hidden />
    </div>
  );

  if (!detail) {
    return (
      <main className="screen study-detail">
        {header("Study")}
        <p className="muted" style={{ padding: "24px 4px" }}>Loading…</p>
      </main>
    );
  }

  return (
    <main className="screen study-detail">
      {header(detail.title)}

      <div className="study-detail__actions">
        <button type="button" className="cta cta--primary cta--block"
                disabled={detail.items.length === 0} onClick={() => onCram(listId)}>
          Study now ({detail.items.length})
        </button>
      </div>

      <ul className="study-detail__items">
        {detail.items.map((it) => (
          <MemberRow key={it.id} item={it} onRemove={() => onRemove(it.id)} />
        ))}
        {detail.items.length === 0 && <li className="muted study__empty">No cards yet — add some below.</li>}
      </ul>

      <section className="study-add">
        <div className="lessons__mode-toggle" role="tablist" aria-label="Add cards">
          <button type="button" role="tab" aria-selected={addMode === "search"}
                  className={`lessons__mode-btn ${addMode === "search" ? "is-active" : ""}`}
                  onClick={() => setAddMode("search")}>
            Search &amp; add
          </button>
          <button type="button" role="tab" aria-selected={addMode === "quick"}
                  className={`lessons__mode-btn ${addMode === "quick" ? "is-active" : ""}`}
                  onClick={() => setAddMode("quick")}>
            Quick-add new
          </button>
        </div>

        {addMode === "search"
          ? <SearchAdd listId={listId} onChanged={refresh} />
          : <QuickAdd listId={listId} onChanged={refresh} />}
      </section>

      <button type="button" className="linkbtn study-detail__delete" onClick={onDelete}>
        Delete this list
      </button>
      <p className="kanji-credit">Kanji data: KanjiVG (CC BY-SA 3.0) · KANJIDIC2 (EDRDG)</p>
    </main>
  );
}

function MemberRow({ item, onRemove }: { item: LibraryItem; onRemove: () => void }) {
  const meta = SKILL_META[item.skill];
  return (
    <li className="study-item">
      <span className="study-item__chip">{meta?.short ?? "?"}</span>
      <span className="study-item__body">
        <span className="study-item__front">{item.front}</span>
        <span className="study-item__meaning">{item.meaning}</span>
      </span>
      <button type="button" className="study-item__remove" onClick={onRemove} aria-label="Remove card">
        <IconClose />
      </button>
    </li>
  );
}

function SearchAdd({ listId, onChanged }: { listId: string; onChanged: () => Promise<void> }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<LibraryItem[]>([]);
  const [busy, setBusy] = useState(false);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    if (!q.trim()) return;
    setBusy(true);
    try {
      const r = await searchStudyCandidates(listId, q.trim());
      setResults(r.items);
    } finally {
      setBusy(false);
    }
  }

  async function add(itemId: string) {
    await addStudyItem(listId, itemId);
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

function QuickAdd({ listId, onChanged }: { listId: string; onChanged: () => Promise<void> }) {
  const [kind, setKind] = useState<QuickKind>("vocab");
  const [phase, setPhase] = useState<QuickPhase>("input");
  const [input, setInput] = useState("");
  const [fields, setFields] = useState<EditFields>({});
  const [readings, setReadings] = useState("");   // kanji only, display-only
  const [error, setError] = useState<string | null>(null);

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
    try {
      const p = await previewStudyItem({ kind, input: input.trim() });
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
      let body: QuickAddStudyItemRequest;
      if (kind === "vocab") {
        body = { kind, japanese: f("japanese"), english: f("english"), sentence_japanese: f("sentence_japanese"), sentence_english: f("sentence_english") };
      } else if (kind === "grammar") {
        body = { kind, pattern: f("pattern"), explanation: f("explanation"), sentence_japanese: f("sentence_japanese"), sentence_english: f("sentence_english") };
      } else {
        body = { kind, character: f("character"), meaning: f("meaning") };
      }
      await quickAddStudyItem(listId, body);
      restart();
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
          {saving ? "Adding…" : "Add to list"}
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
