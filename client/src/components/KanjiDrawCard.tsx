import { useEffect, useRef, useState, type PointerEvent } from "react";
import type { KanjiDetail, ReviewResult } from "@nihongo/shared";
import { fetchKanji } from "../api-hooks";

// KanjiVG paths are authored on a 109×109 canvas.
const VB = 109;
const STROKE_MS = 640; // per-stroke draw time for the order animation

type Props = {
  character: string;
  meaning: string;
  reading: string | null;
  onAnswer: (result: ReviewResult) => void;
};

// Trace-and-self-grade drawing surface. Shows a faint reference glyph to trace
// over, animates the correct stroke order on demand, and captures freehand ink
// on an overlay canvas (pointer events → touch/stylus/mouse). No auto-scoring:
// the learner rates themselves, feeding the same Leitner grade path.
export function KanjiDrawCard({ character, meaning, reading, onAnswer }: Props) {
  const [detail, setDetail] = useState<KanjiDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playKey, setPlayKey] = useState(0);   // remount the anim layer to replay
  const [playing, setPlaying] = useState(false);
  const [revealed, setRevealed] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setError(null);
    setRevealed(false);
    fetchKanji(character)
      .then((d) => { if (!cancelled) setDetail(d); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "load failed"); });
    return () => { cancelled = true; };
  }, [character]);

  // Match the canvas backing resolution to its rendered size for crisp ink.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.scale(dpr, dpr);
      ctx.lineWidth = 6;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = getComputedStyle(canvas).color || "#f0ebe2";
    }
  }, [detail]);

  function pointFromEvent(e: PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function onPointerDown(e: PointerEvent<HTMLCanvasElement>) {
    e.stopPropagation();
    canvasRef.current?.setPointerCapture(e.pointerId);
    drawing.current = true;
    last.current = pointFromEvent(e);
  }

  function onPointerMove(e: PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    e.stopPropagation();
    const ctx = canvasRef.current?.getContext("2d");
    const p = pointFromEvent(e);
    if (ctx && last.current) {
      ctx.beginPath();
      ctx.moveTo(last.current.x, last.current.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
    last.current = p;
  }

  function onPointerUp(e: PointerEvent<HTMLCanvasElement>) {
    drawing.current = false;
    last.current = null;
    canvasRef.current?.releasePointerCapture?.(e.pointerId);
  }

  function clearCanvas() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  function showOrder() {
    setRevealed(true);
    setPlaying(false);
    setPlayKey((k) => k + 1);
    // Let the layer remount with strokes hidden, then start the animation.
    requestAnimationFrame(() => requestAnimationFrame(() => setPlaying(true)));
  }

  return (
    <div className="kanji-draw">
      <div className="kanji-draw__prompt">
        <p className="kanji-draw__meaning">{meaning}</p>
        {reading && <p className="kanji-draw__reading">{reading}</p>}
        <p className="kanji-draw__hint">Draw the kanji, then rate yourself.</p>
      </div>

      <div className="kanji-draw__surface">
        <svg className="kanji-draw__grid" viewBox={`0 0 ${VB} ${VB}`} aria-hidden>
          <rect x="0.5" y="0.5" width={VB - 1} height={VB - 1} className="kanji-draw__frame" />
          <line x1={VB / 2} y1="0" x2={VB / 2} y2={VB} className="kanji-draw__guide" />
          <line x1="0" y1={VB / 2} x2={VB} y2={VB / 2} className="kanji-draw__guide" />
        </svg>

        {/* Faint reference glyph to trace over, shown once the strokes load. */}
        {detail && (
          <svg className="kanji-draw__reference" viewBox={`0 0 ${VB} ${VB}`} aria-hidden>
            {detail.strokes.map((d, i) => (
              <path key={i} d={d} />
            ))}
          </svg>
        )}

        {/* Ordered stroke animation, replayed on each "Show order" press. */}
        {detail && revealed && (
          <svg
            key={playKey}
            className={`kanji-draw__anim ${playing ? "is-playing" : ""}`}
            viewBox={`0 0 ${VB} ${VB}`}
            aria-hidden
          >
            {detail.strokes.map((d, i) => (
              <path
                key={i}
                d={d}
                pathLength={1}
                style={{ animationDelay: `${(i * STROKE_MS) / 1000}s` }}
              />
            ))}
          </svg>
        )}

        <canvas
          ref={canvasRef}
          className="kanji-draw__canvas"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />

        {error && <p className="kanji-draw__error" role="alert">{error}</p>}
      </div>

      <div className="kanji-draw__tools">
        <button type="button" className="linkbtn" onClick={showOrder} disabled={!detail}>
          Show order
        </button>
        <button type="button" className="linkbtn" onClick={clearCanvas}>
          Clear
        </button>
      </div>

      <div className="grade-bar">
        <button type="button" className="grade-btn grade-btn--missed" onClick={() => onAnswer("missed")}>
          Missed
        </button>
        <button type="button" className="grade-btn grade-btn--got" onClick={() => onAnswer("got_it")}>
          Got it
        </button>
      </div>
    </div>
  );
}
