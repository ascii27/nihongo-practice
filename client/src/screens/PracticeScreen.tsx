import { useEffect, useRef, useState } from "react";
import type { ItemRecord, ReviewResult } from "@nihongo/shared";
import { fetchQueue, startSession, endSession, submitReview } from "../api-hooks";
import { FlipCard } from "../components/FlipCard";

type Phase = "loading" | "empty" | "reviewing" | "summary" | "error";

type Props = {
  onDone: () => void;
};

export function PracticeScreen({ onDone }: Props) {
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
        const [{ id }, queue] = await Promise.all([startSession(), fetchQueue()]);
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
  }, []);

  function handleAnswer(result: ReviewResult) {
    const item = items[index];
    if (!item) return;
    setCounts((c) => result === "got_it" ? { ...c, got: c.got + 1 } : { ...c, missed: c.missed + 1 });

    // Optimistically advance.
    const reviewedAt = new Date().toISOString();
    void retryingSubmit({
      item_id: item.id,
      result,
      reviewed_at: reviewedAt,
      session_id: sessionIdRef.current ?? undefined,
    });

    if (index + 1 >= items.length) {
      void finishSession();
    } else {
      setIndex(index + 1);
    }
  }

  async function finishSession() {
    if (sessionIdRef.current) {
      try { await endSession(sessionIdRef.current); } catch { /* tolerate failure; UI moves on */ }
    }
    setPhase("summary");
  }

  if (phase === "loading") return <main className="screen screen--centered">Loading…</main>;
  if (phase === "error") return <main className="screen screen--centered"><p role="alert">{error}</p></main>;
  if (phase === "empty") {
    return (
      <main className="screen screen--centered">
        <p>Nothing due right now.</p>
        <button type="button" className="cta" onClick={onDone}>Back to Today</button>
      </main>
    );
  }
  if (phase === "summary") {
    return (
      <main className="screen screen--centered">
        <h1>Done</h1>
        <p>{counts.got} got it · {counts.missed} missed</p>
        <button type="button" className="cta" onClick={onDone}>Back to Today</button>
      </main>
    );
  }
  const current = items[index];
  if (!current) return <main className="screen">No item</main>;
  return (
    <main className="screen screen--practice">
      <p className="practice__progress">{index + 1} / {items.length}</p>
      <FlipCard key={current.id} item={current} onAnswer={handleAnswer} />
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
