import { useEffect, useRef, useState, type ReactNode, type PointerEvent } from "react";
import type { ReviewResult } from "@nihongo/shared";

type Props = {
  onSwipe: (result: ReviewResult) => void;
  canSwipe?: boolean;       // gate gestures until the card is flipped/answered
  resetKey: string;         // reset internal state when the card changes
  children: ReactNode;
};

const THRESHOLD = 100;

// Wraps a practice card in a draggable surface. A horizontal drag past the
// threshold flings the card off (right = got it, left = missed) and reports the
// grade. Vertical drags are ignored so the card can still scroll.
export function SwipeDeck({ onSwipe, canSwipe = true, resetKey, children }: Props) {
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [exiting, setExiting] = useState<"left" | "right" | null>(null);
  const startX = useRef(0);
  const startY = useRef(0);
  const horizontal = useRef(false);

  useEffect(() => {
    setDx(0);
    setDragging(false);
    setExiting(null);
    horizontal.current = false;
  }, [resetKey]);

  function onPointerDown(e: PointerEvent) {
    if (!canSwipe || exiting) return;
    startX.current = e.clientX;
    startY.current = e.clientY;
    setDragging(true);
    horizontal.current = false;
    // Note: do NOT capture the pointer here. Capturing on pointerdown retargets
    // the eventual `click` to this surface, which would swallow taps on the
    // inner grade/Next buttons. We capture only once a real drag starts.
  }

  function onPointerMove(e: PointerEvent) {
    if (!dragging || exiting) return;
    const ndx = e.clientX - startX.current;
    const ndy = e.clientY - startY.current;
    if (!horizontal.current) {
      if (Math.abs(ndx) > 8 && Math.abs(ndx) > Math.abs(ndy)) {
        horizontal.current = true;
        e.currentTarget.setPointerCapture?.(e.pointerId); // keep receiving move/up mid-fling
      } else if (Math.abs(ndy) > 12) {
        setDragging(false);
        return;
      }
    }
    if (horizontal.current) setDx(ndx);
  }

  function onPointerUp() {
    if (!dragging) return;
    setDragging(false);
    if (dx > THRESHOLD) {
      setExiting("right");
      setTimeout(() => onSwipe("got_it"), 220);
    } else if (dx < -THRESHOLD) {
      setExiting("left");
      setTimeout(() => onSwipe("missed"), 220);
    } else {
      setDx(0);
    }
  }

  const x = exiting === "right" ? 600 : exiting === "left" ? -600 : dx;
  const rot = x / 25;
  const transition = dragging
    ? "none"
    : "transform 220ms cubic-bezier(.2,.7,.2,1), opacity 220ms ease";
  const gotOpacity = Math.max(0, Math.min(1, dx / 120));
  const missedOpacity = Math.max(0, Math.min(1, -dx / 120));

  return (
    <div className="swipe-wrap">
      <div
        className="swipe-card"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{
          transform: `translateX(${x}px) rotate(${rot}deg)`,
          transition,
          opacity: exiting ? 0 : 1,
          cursor: canSwipe ? "grab" : "default",
        }}
      >
        <div className="swipe-badge swipe-badge--got" style={{ opacity: gotOpacity }}>✓ Got it</div>
        <div className="swipe-badge swipe-badge--missed" style={{ opacity: missedOpacity }}>✗ Missed</div>
        {children}
      </div>
    </div>
  );
}
