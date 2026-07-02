import { useEffect, useState } from "react";
import type { LessonSummary, Skill } from "@nihongo/shared";
import { fetchLessons, createLesson, fetchLessonStatus } from "../api-hooks";
import { SKILL_ORDER, SKILL_META } from "../lib/skills";

const LEVELS = ["N5", "N4", "N3", "N2", "N1"];

type Props = { onOpenLesson: (id: string) => void };

export function LessonsScreen({ onOpenLesson }: Props) {
  const [lessons, setLessons] = useState<LessonSummary[]>([]);
  const [topic, setTopic] = useState("");
  const [level, setLevel] = useState("N4");
  const [skills, setSkills] = useState<Skill[]>([...SKILL_ORDER]);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const r = await fetchLessons();
    setLessons(r.lessons);
  }
  useEffect(() => { void refresh(); }, []);

  function toggleSkill(s: Skill) {
    setSkills((prev) => prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!topic.trim() || skills.length === 0) return;
    setBusy(true);
    try {
      const { id } = await createLesson({ topic: topic.trim(), jlpt_level: level, skills });
      setTopic("");
      await refresh();
      // Poll the new lesson until it leaves 'generating'.
      const poll = async () => {
        const s = await fetchLessonStatus(id);
        if (s.status === "generating") { setTimeout(() => void poll(), 1500); }
        else { await refresh(); }
      };
      void poll();
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="screen lessons">
      <h1 className="lessons__title">Lessons</h1>

      <form className="lessons__form" onSubmit={submit}>
        <label className="settings__field">
          <span className="settings__field-label">Topic</span>
          <input className="settings__input" placeholder="e.g. giving directions" maxLength={120}
                 value={topic} onChange={(e) => setTopic(e.target.value)} disabled={busy} />
        </label>
        <label className="settings__field">
          <span className="settings__field-label">Level</span>
          <select className="settings__select" value={level} onChange={(e) => setLevel(e.target.value)} disabled={busy}>
            {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </label>
        <div className="lessons__skills">
          {SKILL_ORDER.map((s) => (
            <label key={s} className={`lessons__skill ${skills.includes(s) ? "is-on" : ""}`}>
              <input type="checkbox" checked={skills.includes(s)} onChange={() => toggleSkill(s)} disabled={busy} />
              {SKILL_META[s].label}
            </label>
          ))}
        </div>
        <button type="submit" className="cta cta--primary cta--block" disabled={busy || !topic.trim() || skills.length === 0}>
          {busy ? "Creating…" : "Create lesson"}
        </button>
      </form>

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
