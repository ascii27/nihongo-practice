import { useState } from "react";
import type { ItemRecord, ExplainPrompt, ExplainAnswer, ExplainGrade, ReviewResult } from "@nihongo/shared";
import { RubyText } from "./RubyText";
import { gradeExplanation } from "../api-hooks";

type Props = {
  item: ItemRecord;
  onAnswer: (result: ReviewResult, answer_given?: string) => void;
};

type Phase =
  | { kind: "writing" }
  | { kind: "grading" }
  | { kind: "graded"; grade: ExplainGrade; result: ReviewResult }
  | { kind: "error"; message: string };

const DIMENSIONS: Array<{ key: keyof ExplainGrade; label: string }> = [
  { key: "connective_use", label: "Connectives" },
  { key: "structure", label: "Structure" },
  { key: "register", label: "Register" },
  { key: "grammar", label: "Grammar" },
];

export function ProductionCard({ item, onAnswer }: Props) {
  const prompt = item.prompt as ExplainPrompt;
  const answer = item.answer as ExplainAnswer;
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "writing" });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || phase.kind === "grading") return;
    setPhase({ kind: "grading" });
    try {
      const r = await gradeExplanation({ item_id: item.id, answer_given: text.trim().slice(0, 2000) });
      setPhase({ kind: "graded", grade: r.grade, result: r.result });
    } catch (err) {
      setPhase({ kind: "error", message: err instanceof Error ? err.message : "grading failed" });
    }
  }

  function advance(result: ReviewResult) {
    onAnswer(result, text.trim().slice(0, 200));
  }

  return (
    <div className="production-card">
      <span className="flipcard__skill-chip">Explain</span>
      <p className="production-card__task">{prompt.task_english}</p>
      {prompt.task_japanese_ruby && (
        <RubyText html={prompt.task_japanese_ruby} className="production-card__task-ja ruby-hi-contrast" />
      )}
      <div className="production-card__constraints">
        <span className="production-card__register">Register: {prompt.register}</span>
        <ul className="production-card__connectives">
          {prompt.required_connectives.map((c) => <li key={c}>{c}</li>)}
        </ul>
      </div>

      {phase.kind === "writing" || phase.kind === "grading" ? (
        <form onSubmit={submit} className="production-card__form">
          <textarea
            className="production-card__input"
            rows={4}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Write 2–4 sentences in Japanese…"
            disabled={phase.kind === "grading"}
          />
          <button type="submit" className="cta cta--primary cta--block" disabled={!text.trim() || phase.kind === "grading"}>
            {phase.kind === "grading" ? "Grading…" : "Submit for grading"}
          </button>
        </form>
      ) : phase.kind === "error" ? (
        <div className="production-card__error">
          <p role="alert" className="is-wrong">{phase.message}</p>
          <button type="button" className="cta cta--primary cta--block" onClick={() => setPhase({ kind: "writing" })}>
            Try again
          </button>
        </div>
      ) : (
        <div className="production-card__reveal">
          <div className="production-card__scores">
            {DIMENSIONS.map((d) => (
              <div key={d.key} className="production-card__score">
                <span className="production-card__score-label">{d.label}</span>
                <span className="production-card__score-val">{Math.round((phase.grade[d.key] as number) * 100)}%</span>
              </div>
            ))}
          </div>
          <p className={`production-card__overall ${phase.result === "got_it" ? "is-correct" : "is-wrong"}`}>
            Overall {Math.round(phase.grade.overall * 100)}% — {phase.result === "got_it" ? "passed" : "keep practicing"}
          </p>
          <p className="production-card__feedback">{phase.grade.feedback}</p>
          <div>
            <p className="production-card__section-label">Corrected</p>
            <RubyText html={phase.grade.corrected_ruby} className="production-card__corrected ruby-hi-contrast" />
          </div>
          <div>
            <p className="production-card__section-label">Model answer</p>
            <RubyText html={answer.model_explanation_ruby} className="production-card__model ruby-hi-contrast" />
          </div>
          <div className="grade-bar">
            <button type="button" className="grade-btn grade-btn--missed" onClick={() => advance("missed")}>
              Missed
            </button>
            <button type="button" className="grade-btn grade-btn--got" onClick={() => advance("got_it")}>
              Got it
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
