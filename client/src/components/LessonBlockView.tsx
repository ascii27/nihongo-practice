import { useEffect, useState } from "react";
import type {
  ItemRecord,
  LessonBlock,
  ReviewResult,
  QuizQuestion,
  VocabPrompt,
  VocabAnswer,
  ReadingPrompt,
  ReadingAnswer,
} from "@nihongo/shared";
import { FlipCard } from "./FlipCard";
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
      return <QuizBlockView questions={block.questions} onDone={onDone} />;
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

// The final quiz — a mix of question formats, scored, lesson-only (no SRS
// submit). Shows progress through the questions and a score at the end.
function QuizBlockView({ questions, onDone }: { questions: QuizQuestion[]; onDone: () => void }) {
  const [i, setI] = useState(0);
  const [chosen, setChosen] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  const [finished, setFinished] = useState(false);

  const empty = questions.length === 0;
  useEffect(() => {
    if (empty) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empty]);
  if (empty) return null;

  if (finished) {
    return (
      <div className="quiz-result">
        <div className="quiz-result__score">{score}<span className="quiz-result__total">/{questions.length}</span></div>
        <p className="quiz-result__label">Quiz complete</p>
        <button type="button" className="cta cta--primary cta--lg cta--block" onClick={onDone}>Finish lesson →</button>
      </div>
    );
  }

  const q = questions[i]!;
  const decided = chosen !== null;
  const isLast = i + 1 >= questions.length;

  function choose(idx: number) {
    if (decided) return;
    setChosen(idx);
    if (idx === q.answer_index) setScore((s) => s + 1);
  }
  function next() {
    if (isLast) { setFinished(true); return; }
    setI(i + 1);
    setChosen(null);
  }

  return (
    <div className="mc-card quiz">
      <div className="quiz__progress">Question {i + 1} / {questions.length}</div>
      <p className="quiz__question">{q.question}</p>
      {q.sentence_ruby ? <RubyText html={q.sentence_ruby} className="mc-card__sentence" /> : null}
      <div className="mc-card__options">
        {q.options.map((opt, idx) => {
          const isChosen = chosen === idx;
          const isCorrect = idx === q.answer_index;
          const cls = !decided ? "mc-option"
            : isChosen && isCorrect ? "mc-option mc-option--correct"
            : isChosen && !isCorrect ? "mc-option mc-option--wrong"
            : isCorrect ? "mc-option mc-option--correct-reveal"
            : "mc-option mc-option--muted";
          return (
            <button key={idx} type="button" className={cls} disabled={decided} onClick={() => choose(idx)}>
              {opt}
            </button>
          );
        })}
      </div>
      {decided ? (
        <>
          <p className={`mc-card__feedback ${chosen === q.answer_index ? "is-correct" : "is-wrong"}`}>{q.explanation}</p>
          <button type="button" className="cta cta--primary cta--block" onClick={next}>
            {isLast ? "See score →" : "Next →"}
          </button>
        </>
      ) : null}
    </div>
  );
}
