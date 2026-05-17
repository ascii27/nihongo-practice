import { useState } from "react";
import type { Skill } from "@nihongo/shared";
import { generateItems } from "../api-hooks";
import { ApiError } from "../api";

const LABEL: Record<Skill, string> = {
  vocab: "Vocab",
  grammar: "Grammar",
  particle: "Particles",
  conjugation: "Conjugation",
  reading: "Reading",
};

const DEFAULT_COUNT: Record<Skill, number> = {
  vocab: 10,
  grammar: 10,
  particle: 10,
  conjugation: 5,
  reading: 3,
};

type Props = {
  skill: Skill;
  due: number;
  newCount: number;
  available: boolean;       // false → "coming soon" CTA disabled
  onPractice: () => void;
  onGenerated: () => void;
};

export function SkillCard({ skill, due, newCount, available, onPractice, onGenerated }: Props) {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const total = due + newCount;

  async function generate() {
    setGenerating(true);
    setError(null);
    try {
      await generateItems({ skill, count: DEFAULT_COUNT[skill] });
      onGenerated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : "failed");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <article className={`skill-card skill-card--${skill} ${available ? "" : "is-locked"}`}>
      <h3 className="skill-card__name">{LABEL[skill]}</h3>
      {!available ? (
        <p className="skill-card__hint muted">Coming soon</p>
      ) : total > 0 ? (
        <>
          <p className="skill-card__count">{total}</p>
          <p className="skill-card__hint muted">{due} due · {newCount} new</p>
          <button type="button" className="skill-card__cta" onClick={onPractice}>Practice →</button>
        </>
      ) : (
        <>
          <p className="skill-card__count skill-card__count--empty">0</p>
          <p className="skill-card__hint muted">All caught up</p>
          <button type="button" className="skill-card__cta skill-card__cta--secondary" onClick={generate} disabled={generating}>
            {generating ? "Generating…" : `Generate ${DEFAULT_COUNT[skill]}`}
          </button>
          {error && <p role="alert" className="skill-card__error">Failed — try again</p>}
        </>
      )}
    </article>
  );
}
