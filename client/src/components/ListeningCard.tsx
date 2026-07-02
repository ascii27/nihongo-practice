import { useState } from "react";
import type { ItemRecord, ListeningPrompt, ListeningAnswer, ReviewResult } from "@nihongo/shared";
import { RubyText } from "./RubyText";
import { SwipeDeck } from "./SwipeDeck";

type Props = { item: ItemRecord; onAnswer: (result: ReviewResult) => void };

const AUDIO_BASE = import.meta.env.VITE_API_BASE ?? "";
const PASS = 0.6; // fraction correct to count as got_it (mirrors explain)

export function ListeningCard({ item, onAnswer }: Props) {
  const prompt = item.prompt as ListeningPrompt;
  const answer = item.answer as ListeningAnswer;
  const [qi, setQi] = useState(0);
  const [picks, setPicks] = useState<number[]>([]);
  const [revealed, setRevealed] = useState(false);
  const [result, setResult] = useState<ReviewResult | null>(null);

  const q = prompt.questions[qi];
  const decided = picks[qi] !== undefined;
  const isLast = qi + 1 >= prompt.questions.length;

  if (!q) return null; // out-of-range guard; noUncheckedIndexedAccess narrows prompt.questions[qi]

  function choose(i: number) {
    if (decided) return;
    setPicks((prev) => { const next = [...prev]; next[qi] = i; return next; });
  }

  function next() {
    if (isLast) {
      const correct = prompt.questions.reduce((n, qq, i) => n + (picks[i] === qq.answer_index ? 1 : 0), 0);
      setResult(correct / prompt.questions.length >= PASS ? "got_it" : "missed");
      setRevealed(true);
    } else {
      setQi(qi + 1);
    }
  }

  return (
    <SwipeDeck onSwipe={onAnswer} canSwipe={false} resetKey={item.id}>
      <div className="mc-card">
        <span className="flipcard__skill-chip">Listening</span>
        <audio controls src={`${AUDIO_BASE}${prompt.audio_url}`} className="listening-card__audio" />

        {!revealed ? (
          <>
            <p className="listening-card__q">{qi + 1}/{prompt.questions.length}. {q.question_english}</p>
            <div className="mc-card__options">
              {q.options.map((opt, i) => {
                const chosen = picks[qi];
                const isChosen = i === chosen;
                const isCorrect = i === q.answer_index;
                const cls = !decided ? "mc-option"
                  : isChosen && isCorrect ? "mc-option mc-option--correct"
                  : isChosen && !isCorrect ? "mc-option mc-option--wrong"
                  : isCorrect ? "mc-option mc-option--correct-reveal"
                  : "mc-option mc-option--muted";
                return (
                  <button key={i} type="button" className={cls} onClick={() => choose(i)} disabled={decided} aria-pressed={isChosen}>
                    {opt}
                    {decided && isCorrect && <span aria-hidden>✓</span>}
                    {decided && isChosen && !isCorrect && <span aria-hidden>✗</span>}
                  </button>
                );
              })}
            </div>
            {decided && (
              <button type="button" className="cta cta--primary cta--block" onClick={next}>
                {isLast ? "Finish →" : "Next question →"}
              </button>
            )}
          </>
        ) : (
          <div className="listening-card__reveal">
            <h3>Transcript</h3>
            <RubyText html={answer.transcript_ruby} className="ruby-hi-contrast" />
            <p className="muted">{answer.translation_english}</p>
            {answer.question_explanations && answer.question_explanations.some((e) => e !== "") && (
              <ul className="listening-card__explanations">
                {answer.question_explanations
                  .filter((e) => e !== "")
                  .map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
              </ul>
            )}
            <button
              type="button"
              className="cta cta--primary cta--block"
              onClick={() => result && onAnswer(result)}
            >
              Continue →
            </button>
          </div>
        )}
      </div>
    </SwipeDeck>
  );
}
