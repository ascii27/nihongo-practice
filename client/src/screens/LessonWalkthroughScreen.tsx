import { useEffect, useState } from "react";
import type { LessonDetail } from "@nihongo/shared";
import { fetchLessonDetail, updateLessonState } from "../api-hooks";
import { LessonSection } from "../components/LessonSection";
import { IconClose } from "../components/icons";

type Props = { lessonId: string; onExit: () => void };
type Phase = "loading" | "walking" | "done" | "error";

export function LessonWalkthroughScreen({ lessonId, onExit }: Props) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [detail, setDetail] = useState<LessonDetail | null>(null);
  const [sectionIdx, setSectionIdx] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = await fetchLessonDetail(lessonId);
        if (cancelled) return;
        setDetail(d);
        setPhase(d.sections.length ? "walking" : "done");
        if (d.sections.length) {
          void updateLessonState(lessonId, { progress: "in_progress", current_section: d.sections[0]!.section, current_index: 0 }).catch(() => {});
        }
      } catch {
        if (!cancelled) setPhase("error");
      }
    })();
    return () => { cancelled = true; };
  }, [lessonId]);

  function nextSection() {
    if (!detail) return;
    const next = sectionIdx + 1;
    if (next >= detail.sections.length) {
      void updateLessonState(lessonId, { progress: "completed", current_section: null, current_index: 0 }).catch(() => {});
      setPhase("done");
    } else {
      setSectionIdx(next);
      void updateLessonState(lessonId, { progress: "in_progress", current_section: detail.sections[next]!.section, current_index: 0 }).catch(() => {});
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

  const section = detail!.sections[sectionIdx]!;
  const progress = (sectionIdx / detail!.sections.length) * 100;
  return (
    <main className="screen screen--practice">
      <div className="practice-bar">
        <button type="button" className="practice-bar__close" onClick={onExit} aria-label="Exit lesson"><IconClose /></button>
        <div className="practice-bar__progress"><div className="practice-bar__progress-fill" style={{ width: `${progress}%` }} /></div>
        <span className="practice-bar__count">{sectionIdx + 1}/{detail!.sections.length}</span>
      </div>
      <div className="practice-stage">
        <LessonSection key={section.section} section={section.section} items={section.items} onDone={nextSection} />
      </div>
    </main>
  );
}
