import { useState } from "react";
import type { ItemRecord, ParticlePrompt, ParticleAnswer, ReviewResult } from "@nihongo/shared";
import { RubyText } from "./RubyText";
import { SwipeDeck } from "./SwipeDeck";

type Props = {
  item: ItemRecord;
  onAnswer: (result: ReviewResult) => void;
};

// Particles — tap an option to lock it in, see feedback, then advance. The
// grade is auto-derived from correctness, so the card never swipes.
export function MultipleChoiceCard({ item, onAnswer }: Props) {
  const prompt = item.prompt as ParticlePrompt;
  const answer = item.answer as ParticleAnswer;
  const [chosen, setChosen] = useState<number | null>(null);

  const decided = chosen !== null;
  const correct = decided && chosen === prompt.answer_index;

  function choose(i: number) {
    if (!decided) setChosen(i);
  }

  return (
    <SwipeDeck onSwipe={onAnswer} canSwipe={false} resetKey={item.id}>
      <div className="mc-card">
        <span className="flipcard__skill-chip">Particles</span>
        <RubyText html={prompt.sentence_ruby_blanked} className="mc-card__sentence ruby-hi-contrast" />

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
                {decided && isCorrect && <span aria-hidden>✓</span>}
                {decided && isChosen && !isCorrect && <span aria-hidden>✗</span>}
              </button>
            );
          })}
        </div>

        {decided && (
          <>
            <p className={`mc-card__feedback ${correct ? "is-correct" : "is-wrong"}`}>
              {correct ? "Correct." : "Not quite."} {answer.explanation}
            </p>
            <button type="button" className="cta cta--primary cta--block" onClick={() => onAnswer(correct ? "got_it" : "missed")}>
              Next →
            </button>
          </>
        )}
      </div>
    </SwipeDeck>
  );
}
