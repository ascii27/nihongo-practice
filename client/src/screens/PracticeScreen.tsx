import { useEffect, useRef, useState } from "react";
import type { ItemRecord, ReviewResult, Skill } from "@nihongo/shared";
import { fetchQueue, startSession, endSession, submitReview } from "../api-hooks";
import { FlipCard } from "../components/FlipCard";
import { MultipleChoiceCard } from "../components/MultipleChoiceCard";
import { TypedInputCard } from "../components/TypedInputCard";
import { ProductionCard } from "../components/ProductionCard";
import { IconClose } from "../components/icons";

type Phase = "loading" | "empty" | "reviewing" | "summary" | "error";

type Props = {
  onDone: () => void;
  skill?: Skill;        // optional filter; undefined = mixed
};

export function PracticeScreen({ onDone, skill }: Props) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<ItemRecord[]>([]);
  const [index, setIndex] = useState(0);
  const [counts, setCounts] = useState({ got: 0, missed: 0 });
  const sessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [{ id }, queue] = await Promise.all([startSession(skill), fetchQueue(skill)]);
        if (cancelled) return;
        sessionIdRef.current = id;
        const all = [...queue.due, ...queue.new];
        setItems(all);
        setPhase(all.length === 0 ? "empty" : "reviewing");
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "load failed");
        setPhase("error");
      }
    })();
    return () => { cancelled = true; };
  }, [skill]);

  function handleAnswer(result: ReviewResult) {
    handleAnswerWithText(result);
  }

  function handleAnswerWithText(result: ReviewResult, answer_given?: string) {
    const item = items[index];
    if (!item) return;
    setCounts((c) => result === "got_it" ? { ...c, got: c.got + 1 } : { ...c, missed: c.missed + 1 });
    void retryingSubmit({
      item_id: item.id,
      result,
      reviewed_at: new Date().toISOString(),
      session_id: sessionIdRef.current ?? undefined,
      answer_given,
    });
    if (index + 1 >= items.length) {
      void finishSession();
    } else {
      setIndex(index + 1);
    }
  }

  async function finishSession() {
    if (sessionIdRef.current) {
      try { await endSession(sessionIdRef.current); } catch { /* tolerate failure */ }
    }
    setPhase("summary");
  }

  function practiceAgain() {
    setIndex(0);
    setCounts({ got: 0, missed: 0 });
    setPhase("reviewing");
  }

  if (phase === "loading") return <main className="screen screen--centered">Loading…</main>;
  if (phase === "error") return <main className="screen screen--centered"><p role="alert">{error}</p></main>;

  if (phase === "empty") {
    return (
      <main className="screen screen--centered">
        <p style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 500 }}>Nothing due here.</p>
        <p className="muted">Generate more from Settings.</p>
        <button type="button" className="cta cta--primary" onClick={onDone}>Back to Today</button>
      </main>
    );
  }

  if (phase === "summary") {
    const total = counts.got + counts.missed;
    const pct = total ? Math.round((counts.got / total) * 100) : 0;
    return (
      <main className="screen screen--practice">
        <div className="summary">
          <div className="summary__seal">了</div>
          <h1 className="summary__title">Session complete</h1>
          <p className="summary__sub">{counts.got} of {total} cards — {pct}% accuracy</p>
          <div className="summary__stats">
            <div className="summary__stat summary__stat--got">
              <div className="summary__stat-num">{counts.got}</div>
              <div className="summary__stat-label">Got it</div>
            </div>
            <div className="summary__stat summary__stat--missed">
              <div className="summary__stat-num">{counts.missed}</div>
              <div className="summary__stat-label">Missed</div>
            </div>
          </div>
          <button type="button" className="cta cta--primary cta--lg cta--block" onClick={onDone}>Back to Today</button>
          <button type="button" className="linkbtn" onClick={practiceAgain}>Practice again</button>
        </div>
      </main>
    );
  }

  const current = items[index];
  if (!current) return <main className="screen">No item</main>;
  const progress = (index / items.length) * 100;

  return (
    <main className="screen screen--practice">
      <div className="practice-bar">
        <button type="button" className="practice-bar__close" onClick={onDone} aria-label="Close practice">
          <IconClose />
        </button>
        <div className="practice-bar__progress">
          <div className="practice-bar__progress-fill" style={{ width: `${progress}%` }} />
        </div>
        <span className="practice-bar__count">{index + 1}/{items.length}</span>
      </div>
      <div className="practice-stage">
        {current.skill === "explain" ? (
          <ProductionCard key={current.id} item={current} onAnswer={handleAnswerWithText} />
        ) : current.skill === "particle" ? (
          <MultipleChoiceCard key={current.id} item={current} onAnswer={handleAnswer} />
        ) : current.skill === "conjugation" ? (
          <TypedInputCard key={current.id} item={current} onAnswer={handleAnswerWithText} />
        ) : (
          <FlipCard key={current.id} item={current} onAnswer={handleAnswer} />
        )}
      </div>
    </main>
  );
}

async function retryingSubmit(input: Parameters<typeof submitReview>[0]): Promise<void> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await submitReview(input);
      return;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 300 * attempt));
    }
  }
  console.error("submitReview failed after 3 attempts", lastErr);
}
