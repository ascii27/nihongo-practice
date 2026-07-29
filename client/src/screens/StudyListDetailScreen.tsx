import { useEffect, useState } from "react";
import type { StudyListDetail, LibraryItem, QuickAddStudyItemRequest } from "@nihongo/shared";
import {
  fetchStudyList, addStudyItem, removeStudyItem, quickAddStudyItem,
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

  if (!detail) return <main className="screen screen--centered">Loading…</main>;

  return (
    <main className="screen study-detail">
      <div className="topbar">
        <button type="button" className="topbar__back" onClick={onBack} aria-label="Back">
          <IconClose />
        </button>
        <h1 className="topbar__title">{detail.title}</h1>
      </div>

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

function QuickAdd({ listId, onChanged }: { listId: string; onChanged: () => Promise<void> }) {
  const [kind, setKind] = useState<QuickKind>("vocab");
  const [busy, setBusy] = useState(false);
  // Shared fields across kinds; only the relevant ones are read on submit.
  const [japanese, setJapanese] = useState("");
  const [english, setEnglish] = useState("");
  const [character, setCharacter] = useState("");
  const [pattern, setPattern] = useState("");
  const [explanation, setExplanation] = useState("");

  function reset() {
    setJapanese(""); setEnglish(""); setCharacter(""); setPattern(""); setExplanation("");
  }

  const ready =
    kind === "vocab" ? japanese.trim() && english.trim()
    : kind === "kanji" ? character.trim()
    : pattern.trim() && explanation.trim();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    try {
      let body: QuickAddStudyItemRequest;
      if (kind === "vocab") body = { kind, japanese: japanese.trim(), english: english.trim() };
      else if (kind === "kanji") body = { kind, character: character.trim() };
      else body = { kind, pattern: pattern.trim(), explanation: explanation.trim() };
      await quickAddStudyItem(listId, body);
      reset();
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="study-quick" onSubmit={submit}>
      <div className="study-quick__kinds" role="tablist" aria-label="Card type">
        {(["vocab", "kanji", "grammar"] as QuickKind[]).map((k) => (
          <button key={k} type="button" role="tab" aria-selected={kind === k}
                  className={`study-quick__kind ${kind === k ? "is-active" : ""}`}
                  onClick={() => setKind(k)}>
            {SKILL_META[k].label}
          </button>
        ))}
      </div>

      {kind === "vocab" && (
        <>
          <input className="settings__input" placeholder="Japanese (e.g. 学校)" value={japanese}
                 onChange={(e) => setJapanese(e.target.value)} maxLength={120} />
          <input className="settings__input" placeholder="English (e.g. school)" value={english}
                 onChange={(e) => setEnglish(e.target.value)} maxLength={120} />
        </>
      )}
      {kind === "kanji" && (
        <input className="settings__input" placeholder="Kanji (e.g. 食)" value={character}
               onChange={(e) => setCharacter(e.target.value)} maxLength={4} />
      )}
      {kind === "grammar" && (
        <>
          <input className="settings__input" placeholder="Pattern (e.g. 〜てから)" value={pattern}
                 onChange={(e) => setPattern(e.target.value)} maxLength={120} />
          <input className="settings__input" placeholder="Meaning / note" value={explanation}
                 onChange={(e) => setExplanation(e.target.value)} maxLength={400} />
        </>
      )}

      <button type="submit" className="cta cta--primary cta--block" disabled={busy || !ready}>
        {busy ? "Adding…" : "Add to list"}
      </button>
    </form>
  );
}
