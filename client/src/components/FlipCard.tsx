import { useState } from "react";
import { RubyText } from "./RubyText";
import type { ItemRecord } from "@nihongo/shared";

type Props = {
  item: ItemRecord;
  onAnswer: (result: "got_it" | "missed") => void;
};

export function FlipCard({ item, onAnswer }: Props) {
  const [revealed, setRevealed] = useState(false);

  const { sentence_ruby, sentence_english, target } = item.prompt;
  const { meaning, reading } = item.answer;

  return (
    <article className={`flipcard ${revealed ? "is-revealed" : ""}`}>
      <div className="flipcard__face flipcard__face--prompt">
        <p className="flipcard__sentence">
          <RubyText html={sentence_ruby} />
        </p>
        {!revealed && (
          <button
            type="button"
            className="flipcard__reveal"
            onClick={() => setRevealed(true)}
          >
            Tap to reveal
          </button>
        )}
      </div>

      {revealed && (
        <div className="flipcard__face flipcard__face--answer">
          <p className="flipcard__sentence-secondary">
            <RubyText html={sentence_ruby} />
          </p>
          <div className="flipcard__answer-block">
            <p className="flipcard__target">
              <ruby>
                {target}
                <rt>{reading}</rt>
              </ruby>
            </p>
            <p className="flipcard__meaning">{meaning}</p>
            <p className="flipcard__english">{sentence_english}</p>
          </div>
          <div className="flipcard__actions">
            <button
              type="button"
              className="flipcard__btn flipcard__btn--missed"
              onClick={() => onAnswer("missed")}
            >
              Missed
            </button>
            <button
              type="button"
              className="flipcard__btn flipcard__btn--got"
              onClick={() => onAnswer("got_it")}
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </article>
  );
}
