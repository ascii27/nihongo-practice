import { useEffect } from "react";

type Props = {
  title: string;        // the tag's name
  count: number;        // cards carrying it
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

// Deleting a tag can't be undone, so the control only opens this: the count
// spelled out, and the destructive choice deliberately the quieter of the two
// buttons. Only the label goes — the cards and their progress stay. Backdrop
// click and Esc both mean "keep".
export function ConfirmDelete({ title, count, busy, onCancel, onConfirm }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-label="Delete this tag"
         onClick={busy ? undefined : onCancel}>
      <div className="sheet__panel confirm" onClick={(e) => e.stopPropagation()}>
        <div className="sheet__bar">
          <span className="sheet__kicker">Delete tag</span>
        </div>
        <p className="confirm__title">Delete “{title}”?</p>
        <p className="confirm__body">
          This removes the tag from its {count} card{count === 1 ? "" : "s"}. The cards and your
          progress on them are kept. It can’t be undone.
        </p>
        <div className="confirm__actions">
          <button type="button" className="cta cta--primary cta--block" onClick={onCancel} disabled={busy}>
            Keep tag
          </button>
          <button type="button" className="linkbtn confirm__destructive" onClick={onConfirm} disabled={busy}>
            {busy ? "Deleting…" : "Delete tag"}
          </button>
        </div>
      </div>
    </div>
  );
}
