import { useState } from "react";
import type { ItemRecord, ReviewResult, KanjiPrompt, KanjiAnswer } from "@nihongo/shared";
import { SwipeDeck } from "./SwipeDeck";
import { KanjiDrawCard } from "./KanjiDrawCard";
import { KanjiMnemonicCard } from "./KanjiMnemonicCard";
import { SKILL_META } from "../lib/skills";

type Props = {
  item: ItemRecord;
  onAnswer: (result: ReviewResult) => void;
};

type Mode = "recognize" | "draw" | "mnemonic";

// A kanji card with two practice modes over the same review:
//   Recognize — tap-to-flip flashcard (glyph → meaning + on/kun readings)
//   Draw      — trace the glyph with stroke-order help, then self-grade
// Both grade through the same onAnswer, so kanji advance the Leitner box like
// any other skill.
export function KanjiCard({ item, onAnswer }: Props) {
  const [mode, setMode] = useState<Mode>("recognize");
  const [flipped, setFlipped] = useState(false);

  const p = item.prompt as KanjiPrompt;
  const a = item.answer as KanjiAnswer;
  const label = SKILL_META.kanji.label;
  const meaning = a.meanings.join(", ");
  const readings = [...a.on, ...a.kun].filter(Boolean).join("、");

  const toggle = (
    <div className="kanji-mode" role="tablist" aria-label="Kanji practice mode">
      <button
        type="button"
        role="tab"
        aria-selected={mode === "recognize"}
        className={`kanji-mode__btn ${mode === "recognize" ? "is-active" : ""}`}
        onClick={() => setMode("recognize")}
      >
        Recognize
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={mode === "draw"}
        className={`kanji-mode__btn ${mode === "draw" ? "is-active" : ""}`}
        onClick={() => setMode("draw")}
      >
        Draw
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={mode === "mnemonic"}
        className={`kanji-mode__btn ${mode === "mnemonic" ? "is-active" : ""}`}
        onClick={() => setMode("mnemonic")}
      >
        Mnemonic
      </button>
    </div>
  );

  // Draw mode owns its own pointer surface; disable swipe-to-grade there.
  return (
    <SwipeDeck onSwipe={onAnswer} canSwipe={mode === "recognize" && flipped} resetKey={item.id}>
      <div className="flipcard-inner">
        <span className="flipcard__skill-chip">{label}</span>
        {toggle}

        {mode === "recognize" ? (
          <div onClick={() => !flipped && setFlipped(true)}>
            <p className="kanji-card__glyph">{p.character}</p>
            {flipped ? (
              <>
                <div className="flipcard__answer">
                  <p className="flipcard__meaning">{meaning}</p>
                  {readings && <p className="flipcard__reading">{readings}</p>}
                  <p className="flipcard__notes">{a.stroke_count} strokes</p>
                </div>
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
        ) : mode === "draw" ? (
          <KanjiDrawCard
            character={p.character}
            meaning={meaning}
            reading={readings || null}
            onAnswer={onAnswer}
          />
        ) : (
          <KanjiMnemonicCard character={p.character} />
        )}
      </div>
    </SwipeDeck>
  );
}
