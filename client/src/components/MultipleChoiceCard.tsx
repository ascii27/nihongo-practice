import { useState } from "react";
import type { ItemRecord, ParticlePrompt, ParticleAnswer, ReviewResult } from "@nihongo/shared";
import { RubyText } from "./RubyText";

type Props = {
  item: ItemRecord;
  onAnswer: (result: ReviewResult) => void;
};

export function MultipleChoiceCard({ item, onAnswer }: Props) {
  const prompt = item.prompt as ParticlePrompt;
  const answer = item.answer as ParticleAnswer;
  const [chosen, setChosen] = useState<number | null>(null);

  const decided = chosen !== null;
  const correct = decided && chosen === prompt.answer_index;

  function choose(i: number) {
    if (decided) return;
    setChosen(i);
  }

  function next() {
    onAnswer(correct ? "got_it" : "missed");
  }

  return (
    <div className="mc-card">
      <RubyText html={prompt.sentence_ruby_blanked} className="mc-card__sentence" />

      <div className="mc-card__options">
        {prompt.options.map((opt, i) => {
          const isChosen = i === chosen;
          const isCorrect = i === prompt.answer_index;
          const cls = !decided
            ? "mc-option"
            : isChosen && isCorrect ? "mc-option mc-option--correct"
            : isChosen && !isCorrect ? "mc-option mc-option--wrong"
            : isCorrect ? "mc-option mc-option--correct-reveal"
            : "mc-option mc-option--muted";
          return (
            <button
              key={i}
              type="button"
              className={cls}
              onClick={() => choose(i)}
              disabled={decided}
              aria-pressed={isChosen}
            >
              {opt}
              {decided && isCorrect && <span aria-hidden> ✓</span>}
              {decided && isChosen && !isCorrect && <span aria-hidden> ✗</span>}
            </button>
          );
        })}
      </div>

      {decided && (
        <>
          <p className={`mc-card__feedback ${correct ? "is-correct" : "is-wrong"}`}>
            {correct ? "Correct" : "Not quite"} — {answer.explanation}
          </p>
          <button type="button" className="cta cta--primary" onClick={next}>
            Next →
          </button>
        </>
      )}
    </div>
  );
}
