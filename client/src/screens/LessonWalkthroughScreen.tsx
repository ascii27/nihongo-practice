import { useEffect, useState } from "react";
import type { LessonBlock, LessonDetail } from "@nihongo/shared";
import { fetchLessonDetail, updateLessonState } from "../api-hooks";
import { LessonBlockView } from "../components/LessonBlockView";
import { IconClose } from "../components/icons";

type Props = { lessonId: string; onExit: () => void };
type Phase = "loading" | "walking" | "done" | "error";

function blockId(block: LessonBlock): string {
  return block.type === "grammar" ? `grammar:${block.point.id}` : block.type;
}

export function LessonWalkthroughScreen({ lessonId, onExit }: Props) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [detail, setDetail] = useState<LessonDetail | null>(null);
  const [blockIdx, setBlockIdx] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = await fetchLessonDetail(lessonId);
        if (cancelled) return;
        setDetail(d);
        setPhase(d.blocks.length ? "walking" : "done");
        if (d.blocks.length) {
          // Resume at the persisted block if this lesson was already in progress.
          const resumeAt = d.current_section
            ? d.blocks.findIndex((b) => blockId(b) === d.current_section)
            : -1;
          const startIdx = resumeAt >= 0 ? resumeAt : 0;
          setBlockIdx(startIdx);
          void updateLessonState(lessonId, { progress: "in_progress", current_section: blockId(d.blocks[startIdx]!), current_index: 0 }).catch(() => {});
        }
      } catch {
        if (!cancelled) setPhase("error");
      }
    })();
    return () => { cancelled = true; };
  }, [lessonId]);

  function nextBlock() {
    if (!detail) return;
    const next = blockIdx + 1;
    if (next >= detail.blocks.length) {
      void updateLessonState(lessonId, { progress: "completed", current_section: null, current_index: 0 }).catch(() => {});
      setPhase("done");
    } else {
      setBlockIdx(next);
      void updateLessonState(lessonId, { progress: "in_progress", current_section: blockId(detail.blocks[next]!), current_index: 0 }).catch(() => {});
    }
  }

  if (phase === "loading") return <main className="screen screen--centered">Loading…</main>;
  if (phase === "error") return <main className="screen screen--centered"><p role="alert">Could not load lesson.</p><button className="cta cta--primary" onClick={onExit}>Back</button></main>;
  if (phase === "done") {
    return (
      <main className="screen screen--practice">
        <div className="summary">
          <div className="summary__seal">了</div>
          <h1 className="summary__title">Lesson complete</h1>
          <p className="summary__sub">These cards are now in your review queue.</p>
          <button type="button" className="cta cta--primary cta--lg cta--block" onClick={onExit}>Back to Today</button>
        </div>
      </main>
    );
  }

  const block = detail!.blocks[blockIdx]!;
  const progress = (blockIdx / detail!.blocks.length) * 100;
  return (
    <main className="screen screen--practice">
      <div className="practice-bar">
        <button type="button" className="practice-bar__close" onClick={onExit} aria-label="Exit lesson"><IconClose /></button>
        <div className="practice-bar__progress"><div className="practice-bar__progress-fill" style={{ width: `${progress}%` }} /></div>
        <span className="practice-bar__count">{blockIdx + 1}/{detail!.blocks.length}</span>
      </div>
      <div className="practice-stage">
        <LessonBlockView key={blockId(block)} block={block} lessonId={lessonId} onDone={nextBlock} />
      </div>
    </main>
  );
}
