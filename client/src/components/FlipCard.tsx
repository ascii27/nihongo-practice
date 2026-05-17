import { useState } from "react";
import type { ItemRecord, VocabPrompt, VocabAnswer, GrammarPrompt, GrammarAnswer, ReviewResult } from "@nihongo/shared";
import { RubyText } from "./RubyText";

type Props = {
  item: ItemRecord;
  onAnswer: (result: ReviewResult) => void;
};

export function FlipCard({ item, onAnswer }: Props) {
  const [flipped, setFlipped] = useState(false);

  return (
    <div className={`flipcard flipcard--${item.skill}`}>
      {!flipped ? (
        <div className="flipcard__face flipcard__face--prompt">
          <PromptFace item={item} />
          <button className="flipcard__reveal" onClick={() => setFlipped(true)} type="button">
            Tap to reveal
          </button>
        </div>
      ) : (
        <div className="flipcard__face flipcard__face--answer">
          <PromptFace item={item} muted />
          <AnswerFace item={item} />
          <div className="flipcard__grade">
            <button className="flipcard__btn flipcard__btn--missed" type="button" onClick={() => onAnswer("missed")}>
              Missed
            </button>
            <button className="flipcard__btn flipcard__btn--got" type="button" onClick={() => onAnswer("got_it")}>
              Got it
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function PromptFace({ item, muted }: { item: ItemRecord; muted?: boolean }) {
  switch (item.skill) {
    case "vocab": {
      const p = item.prompt as VocabPrompt;
      return (
        <div className={`flipcard__prompt ${muted ? "is-muted" : ""}`}>
          <RubyText html={p.sentence_ruby} className="flipcard__sentence" />
          <p className="flipcard__target">{p.target}</p>
        </div>
      );
    }
    case "grammar": {
      const p = item.prompt as GrammarPrompt;
      return (
        <div className={`flipcard__prompt ${muted ? "is-muted" : ""}`}>
          <RubyText html={p.sentence_ruby} className="flipcard__sentence" />
          <span className="flipcard__chip">{p.pattern}</span>
        </div>
      );
    }
    default:
      return <p className="flipcard__prompt">Unsupported skill: {item.skill}</p>;
  }
}

function AnswerFace({ item }: { item: ItemRecord }) {
  switch (item.skill) {
    case "vocab": {
      const p = item.prompt as VocabPrompt;
      const a = item.answer as VocabAnswer;
      return (
        <div className="flipcard__answer">
          <p className="flipcard__reading">{a.reading}</p>
          <p className="flipcard__meaning">{a.meaning}</p>
          <p className="flipcard__sentence-en">{p.sentence_english}</p>
          {a.notes && <p className="flipcard__notes">{a.notes}</p>}
        </div>
      );
    }
    case "grammar": {
      const p = item.prompt as GrammarPrompt;
      const a = item.answer as GrammarAnswer;
      return (
        <div className="flipcard__answer">
          <p className="flipcard__sentence-en">{p.sentence_english}</p>
          <p className="flipcard__explanation">{a.explanation}</p>
          {a.another_example_ruby && (
            <RubyText html={a.another_example_ruby} className="flipcard__another" />
          )}
        </div>
      );
    }
    default:
      return null;
  }
}
