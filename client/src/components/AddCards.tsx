import { useEffect, useState } from "react";
import type { LibraryItem } from "@nihongo/shared";
import { tagItem, quickAddToTag, searchTagCandidates } from "../api-hooks";
import { SKILL_META } from "../lib/skills";
import { IconClose } from "./icons";
import { QuickAddForm } from "./QuickAddForm";

type AddMode = "search" | "quick";

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
          : <QuickAddForm
              saveLabel="Add to tag"
              save={async (body) => { await quickAddToTag(tagId, body); }}
              addedNote={(label) => `Added ${label} to this tag.`}
              onAdded={onChanged}
            />}
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
