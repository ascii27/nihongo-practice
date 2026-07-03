import { useState } from "react";
import type { ItemRecord, LessonTeaching, ReviewResult, Skill } from "@nihongo/shared";
import { FlipCard } from "./FlipCard";
import { MultipleChoiceCard } from "./MultipleChoiceCard";
import { TypedInputCard } from "./TypedInputCard";
import { ProductionCard } from "./ProductionCard";
import { ListeningCard } from "./ListeningCard";
import { RubyText } from "./RubyText";
import { SKILL_META, TASK_INTRO } from "../lib/skills";
import { submitReview } from "../api-hooks";

type Props = { section: Skill; items: ItemRecord[]; teaching: LessonTeaching | null; onDone: () => void };

// A compact face-up "study" line for the teach view — pulls the most useful
// fields per skill straight from the stored prompt/answer.
function TeachLine({ item }: { item: ItemRecord }) {
  const p = item.prompt as Record<string, unknown>;
  const a = item.answer as Record<string, unknown>;
  const ruby = (p.sentence_ruby ?? p.passage_ruby ?? p.sentence_ruby_blanked ?? p.base_ruby ?? p.task_japanese_ruby) as string | undefined;
  const gloss = (a.meaning ?? a.explanation ?? a.answer_english ?? a.translation_english ?? p.tense) as string | undefined;
  const fallback = String(p.target ?? p.pattern ?? p.topic ?? "");
  return (
    <div className="teach__line">
      {ruby ? <RubyText html={ruby} className="teach__ruby" /> : <span className="teach__ruby">{fallback}</span>}
      {gloss ? <span className="teach__gloss">{String(gloss)}</span> : null}
    </div>
  );
}

export function LessonSection({ section, items, teaching, onDone }: Props) {
  const [phase, setPhase] = useState<"teach" | "check">("teach");
  const [i, setI] = useState(0);

  function handleAnswer(result: ReviewResult, answer_given?: string) {
    const item = items[i];
    if (item) {
      void submitReview({ item_id: item.id, result, reviewed_at: new Date().toISOString(), answer_given }).catch(() => {});
    }
    if (i + 1 >= items.length) onDone();
    else setI(i + 1);
  }

  if (phase === "teach") {
    return (
      <div className="teach">
        <h2 className="teach__heading">{SKILL_META[section].label}</h2>
        {teaching ? (
          <div className="teach__body">
            <p className="teach__explanation">{teaching.explanation}</p>
            <div className="teach__examples">
              {teaching.examples.map((ex, idx) => (
                <div className="teach__example" key={idx}>
                  <RubyText html={ex.jp_ruby} className="teach__ruby" />
                  <span className="teach__gloss">{ex.en}</span>
                  {ex.note ? <span className="teach__note">{ex.note}</span> : null}
                </div>
              ))}
            </div>
          </div>
        ) : TASK_INTRO[section] ? (
          <p className="teach__explanation">{TASK_INTRO[section]}</p>
        ) : (
          <div className="teach__lines">
            {items.map((it) => <TeachLine key={it.id} item={it} />)}
          </div>
        )}
        <button type="button" className="cta cta--primary cta--block" onClick={() => setPhase("check")}>Start check →</button>
      </div>
    );
  }

  const current = items[i];
  if (!current) return null;
  const key = current.id;
  if (current.skill === "explain") return <ProductionCard key={key} item={current} onAnswer={handleAnswer} />;
  if (current.skill === "particle") return <MultipleChoiceCard key={key} item={current} onAnswer={handleAnswer} />;
  if (current.skill === "listening") return <ListeningCard key={key} item={current} onAnswer={handleAnswer} />;
  if (current.skill === "conjugation") return <TypedInputCard key={key} item={current} onAnswer={handleAnswer} />;
  return <FlipCard key={key} item={current} onAnswer={handleAnswer} />;
}
