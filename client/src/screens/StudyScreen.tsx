import { useEffect, useState } from "react";
import type { StudyListSummary } from "@nihongo/shared";
import { fetchStudyLists, createStudyList } from "../api-hooks";

type Props = { onOpenList: (id: string) => void };

// The Study tab: a list of custom study lists + a create form. Mirrors the
// Lessons screen (list → drill into a detail screen).
export function StudyScreen({ onOpenList }: Props) {
  const [lists, setLists] = useState<StudyListSummary[]>([]);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const r = await fetchStudyLists();
    setLists(r.study_lists);
  }
  useEffect(() => { void refresh(); }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    try {
      const { id } = await createStudyList({ title: title.trim() });
      setTitle("");
      await refresh();
      onOpenList(id);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="screen lessons">
      <h1 className="lessons__title">Study</h1>
      <p className="study__intro">Build a list mixing vocab, grammar, and kanji — then drill it before class.</p>

      <form className="lessons__form" onSubmit={submit}>
        <label className="settings__field">
          <span className="settings__field-label">New list</span>
          <input className="settings__input" placeholder="e.g. Class Week 5" maxLength={120}
                 value={title} onChange={(e) => setTitle(e.target.value)} disabled={busy} />
        </label>
        <button type="submit" className="cta cta--primary cta--block" disabled={busy || !title.trim()}>
          {busy ? "Creating…" : "Create list"}
        </button>
      </form>

      <ul className="lessons__list">
        {lists.map((l) => (
          <li key={l.id} className="lessons__item">
            <button type="button" className="lessons__item-btn" onClick={() => onOpenList(l.id)}>
              <span className="lessons__item-title">{l.title}</span>
              <span className="lessons__item-meta">{l.item_count} item{l.item_count === 1 ? "" : "s"}</span>
            </button>
          </li>
        ))}
        {lists.length === 0 && <li className="study__empty muted">No lists yet — create one above.</li>}
      </ul>
    </main>
  );
}
