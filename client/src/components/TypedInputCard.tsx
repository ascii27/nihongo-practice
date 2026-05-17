import { useState, useRef, useEffect } from "react";
import type { ItemRecord, ConjugationPrompt, ConjugationAnswer, ReviewResult } from "@nihongo/shared";
import { RubyText } from "./RubyText";
import { answerMatches, normalizeKana, rubyToKana } from "../lib/kana";

type Props = {
  item: ItemRecord;
  onAnswer: (result: ReviewResult, answer_given?: string) => void;
};

export function TypedInputCard({ item, onAnswer }: Props) {
  const prompt = item.prompt as ConjugationPrompt;
  const answer = item.answer as ConjugationAnswer;
  const [value, setValue] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  // Accept either kanji+kana or the kana-only reading derived from expected_ruby,
  // plus any AI-supplied alternates.
  const acceptedAlternates = [rubyToKana(answer.expected_ruby), ...(answer.alternates ?? [])];
  const isCorrect = submitted && answerMatches(value, answer.expected, acceptedAlternates);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(true);
  }

  function grade(result: ReviewResult) {
    onAnswer(result, normalizeKana(value));
  }

  return (
    <div className="typed-card">
      <div className="typed-card__prompt">
        <RubyText html={prompt.base_ruby} className="typed-card__base" />
        <span className="typed-card__tense">{prompt.tense}</span>
      </div>

      {!submitted ? (
        <form onSubmit={submit} className="typed-card__form">
          <input
            ref={inputRef}
            type="text"
            inputMode="text"
            autoCapitalize="none"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Type the conjugated form"
            className="typed-card__input"
          />
          <button type="submit" className="typed-card__submit">Submit</button>
        </form>
      ) : (
        <div className="typed-card__reveal">
          <p className={`typed-card__feedback ${isCorrect ? "is-correct" : "is-wrong"}`}>
            {isCorrect ? "Correct" : "Not quite"} — expected:
          </p>
          <RubyText html={answer.expected_ruby} className="typed-card__expected" />
          {answer.alternates && answer.alternates.length > 0 && (
            <p className="typed-card__alternates muted">
              also accepted: {answer.alternates.join(" · ")}
            </p>
          )}
          <div className="typed-card__grade">
            <button type="button" className="flipcard__btn flipcard__btn--missed" onClick={() => grade("missed")}>
              Missed
            </button>
            <button type="button" className="flipcard__btn flipcard__btn--got" onClick={() => grade("got_it")}>
              Got it
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
