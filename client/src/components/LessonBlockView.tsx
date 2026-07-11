import { useEffect, useState } from "react";
import type {
  ItemRecord,
  LessonBlock,
  ReviewResult,
  VocabPrompt,
  VocabAnswer,
  ReadingPrompt,
  ReadingAnswer,
} from "@nihongo/shared";
import { FlipCard } from "./FlipCard";
import { MultipleChoiceCard } from "./MultipleChoiceCard";
import { ListeningCard } from "./ListeningCard";
import { RubyText } from "./RubyText";
import { submitReview } from "../api-hooks";

type Props = { block: LessonBlock; lessonId: string; onDone: () => void };

export function LessonBlockView({ block, onDone }: Props) {
  switch (block.type) {
    case "grammar":
      return <GrammarBlockView block={block} onDone={onDone} />;
    case "vocab":
      return <VocabBlockView items={block.items} onDone={onDone} />;
    case "reading":
      return <ReadingBlockView item={block.item} onDone={onDone} />;
    case "listening":
      return <ListeningCard key={block.item.id} item={block.item} onAnswer={() => onDone()} />;
    case "quiz":
    case "cloze":
      return <ReviewItemsView items={block.items} onDone={onDone} />;
    default:
      return null;
  }
}

function GrammarBlockView({ block, onDone }: { block: Extract<LessonBlock, { type: "grammar" }>; onDone: () => void }) {
  const { point, dialog, explanation } = block;
  return (
    <div className="teach">
      <h2 className="teach__heading">
        {point.title}
        {point.romaji ? <span className="teach__romaji"> ({point.romaji})</span> : null}
      </h2>
      <p className="teach__meaning">{point.meaning}</p>
      <div className="teach__body">
        <div className="teach__dialog">
          {dialog.map((line, idx) => (
            <div className="teach__dialog-line" key={idx}>
              <span className="teach__dialog-speaker">{line.speaker}</span>
              <div className="teach__dialog-text">
                <RubyText html={line.jp_ruby} className="teach__ruby" />
                <span className="teach__gloss">{line.en}</span>
              </div>
            </div>
          ))}
        </div>
        <p className="teach__explanation">{explanation}</p>
      </div>
      <button type="button" className="cta cta--primary cta--block" onClick={onDone}>Continue →</button>
    </div>
  );
}

function VocabBlockView({ items, onDone }: { items: ItemRecord[]; onDone: () => void }) {
  const [phase, setPhase] = useState<"teach" | "review">("teach");
  const [i, setI] = useState(0);
  const empty = items.length === 0;

  useEffect(() => {
    if (empty) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empty]);

  if (empty) return null;

  if (phase === "teach") {
    return (
      <div className="teach">
        <h2 className="teach__heading">Vocab</h2>
        <div className="teach__lines">
          {items.map((it) => {
            const p = it.prompt as VocabPrompt;
            const a = it.answer as VocabAnswer;
            return (
              <div className="teach__line" key={it.id}>
                <RubyText html={p.sentence_ruby} className="teach__ruby" />
                <span className="teach__target">{p.target}</span>
                <span className="teach__gloss">{a.reading} · {a.meaning}</span>
              </div>
            );
          })}
        </div>
        <button type="button" className="cta cta--primary cta--block" onClick={() => setPhase("review")}>
          Start review →
        </button>
      </div>
    );
  }

  const current = items[i];
  if (!current) return null;

  function handleAnswer(result: ReviewResult) {
    const item = items[i];
    if (item) {
      void submitReview({ item_id: item.id, result, reviewed_at: new Date().toISOString() }).catch(() => {});
    }
    if (i + 1 >= items.length) onDone();
    else setI(i + 1);
  }

  return <FlipCard key={current.id} item={current} onAnswer={handleAnswer} />;
}

function ReadingBlockView({ item, onDone }: { item: ItemRecord; onDone: () => void }) {
  const [revealed, setRevealed] = useState(false);
  const prompt = item.prompt as ReadingPrompt;
  const answer = item.answer as ReadingAnswer;

  return (
    <div className="teach">
      <h2 className="teach__heading">Reading</h2>
      <RubyText html={prompt.passage_ruby} className="teach__ruby is-passage" />
      <p className="teach__gloss">{prompt.question_english}</p>
      {revealed ? (
        <div className="teach__example">
          <p className="teach__gloss">{answer.answer_english}</p>
          {answer.answer_japanese_ruby ? (
            <RubyText html={answer.answer_japanese_ruby} className="teach__ruby" />
          ) : null}
        </div>
      ) : (
        <button type="button" className="cta cta--block" onClick={() => setRevealed(true)}>
          Show answer
        </button>
      )}
      <button type="button" className="cta cta--primary cta--block" onClick={onDone}>Continue →</button>
    </div>
  );
}

function ReviewItemsView({ items, onDone }: { items: ItemRecord[]; onDone: () => void }) {
  const [i, setI] = useState(0);
  const current = items[i];

  useEffect(() => {
    if (!current) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  if (!current) return null;

  function handleAnswer(result: ReviewResult) {
    const item = items[i];
    if (item) {
      void submitReview({ item_id: item.id, result, reviewed_at: new Date().toISOString() }).catch(() => {});
    }
    if (i + 1 >= items.length) onDone();
    else setI(i + 1);
  }

  return <MultipleChoiceCard key={current.id} item={current} onAnswer={handleAnswer} />;
}
