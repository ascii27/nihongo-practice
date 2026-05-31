import { useState } from "react";
import type {
  ItemRecord,
  ReviewResult,
  VocabPrompt,
  VocabAnswer,
  GrammarPrompt,
  GrammarAnswer,
  ReadingPrompt,
  ReadingAnswer,
} from "@nihongo/shared";
import { RubyText } from "./RubyText";
import { SwipeDeck } from "./SwipeDeck";
import { SKILL_META } from "../lib/skills";

type Props = {
  item: ItemRecord;
  onAnswer: (result: ReviewResult) => void;
};

// Vocab / grammar / reading — a tap-to-flip card. Once flipped, the learner
// grades themselves via the buttons or a left/right swipe.
export function FlipCard({ item, onAnswer }: Props) {
  const [flipped, setFlipped] = useState(false);
  const label = SKILL_META[item.skill]?.label ?? item.skill;

  return (
    <SwipeDeck onSwipe={onAnswer} canSwipe={flipped} resetKey={item.id}>
      <div className="flipcard-inner" onClick={() => !flipped && setFlipped(true)}>
        <span className="flipcard__skill-chip">{label}</span>
        <PromptFace item={item} />
        {flipped ? (
          <>
            <AnswerFace item={item} />
            <div className="grade-bar">
              <button type="button" className="grade-btn grade-btn--missed" onClick={() => onAnswer("missed")}>
                Missed
              </button>
              <button type="button" className="grade-btn grade-btn--got" onClick={() => onAnswer("got_it")}>
                Got it
              </button>
            </div>
            <p className="swipe-hint">← swipe missed · got it swipe →</p>
          </>
        ) : (
          <button type="button" className="flipcard__reveal" onClick={() => setFlipped(true)}>
            Tap to reveal
          </button>
        )}
      </div>
    </SwipeDeck>
  );
}

function PromptFace({ item }: { item: ItemRecord }) {
  switch (item.skill) {
    case "vocab": {
      const p = item.prompt as VocabPrompt;
      return (
        <div>
          <RubyText html={p.sentence_ruby} className="flipcard__sentence ruby-hi-contrast" />
          <p className="flipcard__target">{p.target}</p>
        </div>
      );
    }
    case "grammar": {
      const p = item.prompt as GrammarPrompt;
      return (
        <div>
          <RubyText html={p.sentence_ruby} className="flipcard__sentence ruby-hi-contrast" />
          <p className="flipcard__pattern">{p.pattern}</p>
        </div>
      );
    }
    case "reading": {
      const p = item.prompt as ReadingPrompt;
      return (
        <div>
          <RubyText html={p.passage_ruby} className="flipcard__sentence is-passage ruby-hi-contrast" />
          <p className="flipcard__question">{p.question_english}</p>
        </div>
      );
    }
    default:
      return <p className="flipcard__sentence">Unsupported skill: {item.skill}</p>;
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
            <RubyText html={a.another_example_ruby} className="flipcard__another ruby-hi-contrast" />
          )}
        </div>
      );
    }
    case "reading": {
      const a = item.answer as ReadingAnswer;
      return (
        <div className="flipcard__answer">
          <p className="flipcard__answer-en">{a.answer_english}</p>
          {a.answer_japanese_ruby && (
            <RubyText html={a.answer_japanese_ruby} className="flipcard__answer-ja ruby-hi-contrast" />
          )}
        </div>
      );
    }
    default:
      return null;
  }
}
