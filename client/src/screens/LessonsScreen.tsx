import { useEffect, useState } from "react";
import type { LessonSummary, GrammarPoint, JlptLevel } from "@nihongo/shared";
import { fetchLessons, createLesson, fetchLessonStatus, fetchGrammarPoints } from "../api-hooks";

const LEVELS: JlptLevel[] = ["N5", "N4", "N3", "N2", "N1"];
const MAX_GRAMMAR_POINTS = 3;

type Mode = "auto" | "manual";

type Props = { onOpenLesson: (id: string) => void };

export function LessonsScreen({ onOpenLesson }: Props) {
  const [lessons, setLessons] = useState<LessonSummary[]>([]);
  const [mode, setMode] = useState<Mode>("auto");
  const [level, setLevel] = useState<JlptLevel>("N4");
  const [theme, setTheme] = useState("");
  const [grammarPoints, setGrammarPoints] = useState<GrammarPoint[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const r = await fetchLessons();
    setLessons(r.lessons);
  }
  useEffect(() => { void refresh(); }, []);

  useEffect(() => {
    if (mode !== "manual") return;
    let cancelled = false;
    setSelectedIds([]);
    (async () => {
      const r = await fetchGrammarPoints(level);
      if (!cancelled) setGrammarPoints(r.grammar_points);
    })();
    return () => { cancelled = true; };
  }, [mode, level]);

  function toggleGrammarPoint(id: string) {
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= MAX_GRAMMAR_POINTS) return prev;
      return [...prev, id];
    });
  }

  function pollAndRefresh(id: string) {
    const poll = async () => {
      const s = await fetchLessonStatus(id);
      if (s.status === "generating") { setTimeout(() => void poll(), 1500); }
      else { await refresh(); }
    };
    void poll();
  }

  async function submitAuto(e: React.FormEvent) {
    e.preventDefault();
    if (!theme.trim()) return;
    setBusy(true);
    try {
      const { id } = await createLesson({ mode: "auto", theme: theme.trim(), jlpt_level: level });
      setTheme("");
      await refresh();
      pollAndRefresh(id);
    } finally {
      setBusy(false);
    }
  }

  async function submitManual(e: React.FormEvent) {
    e.preventDefault();
    if (selectedIds.length < 1 || selectedIds.length > MAX_GRAMMAR_POINTS) return;
    setBusy(true);
    try {
      const { id } = await createLesson({ mode: "manual", grammar_point_ids: selectedIds, jlpt_level: level });
      setSelectedIds([]);
      await refresh();
      pollAndRefresh(id);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="screen lessons">
      <h1 className="lessons__title">Lessons</h1>

      <div className="lessons__mode-toggle" role="tablist" aria-label="Lesson creation mode">
        <button type="button" role="tab" aria-selected={mode === "auto"}
                className={`lessons__mode-btn ${mode === "auto" ? "is-active" : ""}`}
                onClick={() => setMode("auto")} disabled={busy}>
          Choose for me
        </button>
        <button type="button" role="tab" aria-selected={mode === "manual"}
                className={`lessons__mode-btn ${mode === "manual" ? "is-active" : ""}`}
                onClick={() => setMode("manual")} disabled={busy}>
          Pick grammar
        </button>
      </div>

      {mode === "auto" ? (
        <form className="lessons__form" onSubmit={submitAuto}>
          <label className="settings__field">
            <span className="settings__field-label">Level</span>
            <select className="settings__select" value={level}
                    onChange={(e) => setLevel(e.target.value as JlptLevel)} disabled={busy}>
              {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </label>
          <label className="settings__field">
            <span className="settings__field-label">Theme</span>
            <input className="settings__input" placeholder="e.g. giving advice" maxLength={120}
                   value={theme} onChange={(e) => setTheme(e.target.value)} disabled={busy} />
          </label>
          <button type="submit" className="cta cta--primary cta--block" disabled={busy || !theme.trim()}>
            {busy ? "Creating…" : "Create lesson"}
          </button>
        </form>
      ) : (
        <form className="lessons__form" onSubmit={submitManual}>
          <label className="settings__field">
            <span className="settings__field-label">Level</span>
            <select className="settings__select" value={level}
                    onChange={(e) => setLevel(e.target.value as JlptLevel)} disabled={busy}>
              {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </label>
          <div className="settings__field">
            <span className="settings__field-label">Grammar points ({selectedIds.length}/{MAX_GRAMMAR_POINTS})</span>
            <ul className="lessons__grammar-list">
              {grammarPoints.map((gp) => {
                const checked = selectedIds.includes(gp.id);
                const disabled = busy || (!checked && selectedIds.length >= MAX_GRAMMAR_POINTS);
                return (
                  <li key={gp.id}>
                    <label className={`lessons__grammar-item ${checked ? "is-on" : ""}`}>
                      <input type="checkbox" checked={checked} disabled={disabled}
                             onChange={() => toggleGrammarPoint(gp.id)} />
                      <span className="lessons__grammar-title">
                        {gp.title}
                        {gp.romaji ? <span className="lessons__grammar-romaji"> ({gp.romaji})</span> : null}
                      </span>
                      <span className="lessons__grammar-meaning">{gp.meaning}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>
          <button type="submit" className="cta cta--primary cta--block"
                  disabled={busy || selectedIds.length < 1 || selectedIds.length > MAX_GRAMMAR_POINTS}>
            {busy ? "Creating…" : "Create lesson"}
          </button>
        </form>
      )}

      <ul className="lessons__list">
        {lessons.map((l) => (
          <li key={l.id} className="lessons__item">
            <button type="button" className="lessons__item-btn"
                    disabled={l.status !== "ready"} onClick={() => onOpenLesson(l.id)}>
              <span className="lessons__item-title">{l.title}</span>
              <span className="lessons__item-meta">{l.jlpt_level} · {l.item_count} items</span>
              <span className={`lessons__badge lessons__badge--${l.status === "ready" ? l.progress : l.status}`}>
                {l.status === "ready" ? l.progress.replace("_", " ") : l.status}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}
