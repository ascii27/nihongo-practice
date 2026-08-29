import { useEffect, useState } from "react";
import type {
  ItemDetailResponse,
  VocabPrompt, VocabAnswer,
  GrammarPrompt, GrammarAnswer,
  ParticlePrompt, ParticleAnswer,
  ConjugationPrompt, ConjugationAnswer,
  ReadingPrompt, ReadingAnswer,
  ExplainPrompt, ExplainAnswer,
  ListeningPrompt, ListeningAnswer,
  KanjiPrompt, KanjiAnswer,
} from "@nihongo/shared";
import { fetchItem } from "../api-hooks";
import { RubyText } from "./RubyText";
import { SKILL_META } from "../lib/skills";
import { IconClose } from "./icons";

type Props = {
  itemId: string;
  onClose: () => void;
  // Optional list-scoped action, shown at the foot of the sheet.
  onRemove?: () => void;
};

// A read-only look at one card, opened by tapping a row. Shows the whole card
// — both faces, per skill — plus how well it has stuck. Nothing here grades or
// edits; practising a card still goes through Practice / cram.
export function ItemDetailSheet({ itemId, onClose, onRemove }: Props) {
  const [detail, setDetail] = useState<ItemDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setError(null);
    fetchItem(itemId)
      .then((d) => { if (!cancelled) setDetail(d); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "load failed"); });
    return () => { cancelled = true; };
  }, [itemId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-label="Card detail" onClick={onClose}>
      <div className="sheet__panel" onClick={(e) => e.stopPropagation()}>
        <div className="sheet__bar">
          <span className="sheet__kicker">{detail ? SKILL_META[detail.skill]?.label ?? detail.skill : "Card"}</span>
          <button type="button" className="practice-bar__close" onClick={onClose} aria-label="Close card">
            <IconClose />
          </button>
        </div>

        {error && <p className="muted" role="alert" style={{ color: "var(--error)" }}>Couldn't load: {error}</p>}
        {!detail && !error && <p className="muted">Loading…</p>}

        {detail && (
          <>
            <p className="item-detail__front">{detail.front}</p>
            {detail.reading && <p className="item-detail__reading">{detail.reading}</p>}
            {detail.meaning && <p className="item-detail__meaning">{detail.meaning}</p>}

            <CardBody detail={detail} />
            <Progress detail={detail} />

            {onRemove && (
              <button type="button" className="linkbtn item-detail__remove" onClick={onRemove}>
                Remove from this list
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="item-detail__field">
      <span className="item-detail__field-label">{label}</span>
      <div className="item-detail__field-body">{children}</div>
    </div>
  );
}

// The skill-specific half of the card: whatever the header (front / reading /
// meaning) doesn't already say.
function CardBody({ detail }: { detail: ItemDetailResponse }) {
  switch (detail.skill) {
    case "vocab": {
      const p = detail.prompt as VocabPrompt;
      const a = detail.answer as VocabAnswer;
      return (
        <div className="item-detail__fields">
          {p.sentence_ruby && (
            <Field label="Example">
              <RubyText html={p.sentence_ruby} className="item-detail__jp ruby-hi-contrast" />
            </Field>
          )}
          {p.sentence_english && <Field label="Translation">{p.sentence_english}</Field>}
          {!detail.reading && a.reading && <Field label="Reading">{a.reading}</Field>}
        </div>
      );
    }
    case "grammar": {
      const p = detail.prompt as GrammarPrompt;
      const a = detail.answer as GrammarAnswer;
      return (
        <div className="item-detail__fields">
          {p.sentence_ruby && (
            <Field label="Example">
              <RubyText html={p.sentence_ruby} className="item-detail__jp ruby-hi-contrast" />
            </Field>
          )}
          {p.sentence_english && <Field label="Translation">{p.sentence_english}</Field>}
          {a.another_example_ruby && (
            <Field label="Another example">
              <RubyText html={a.another_example_ruby} className="item-detail__jp ruby-hi-contrast" />
            </Field>
          )}
        </div>
      );
    }
    case "particle": {
      const p = detail.prompt as ParticlePrompt;
      const a = detail.answer as ParticleAnswer;
      return (
        <div className="item-detail__fields">
          <Field label="Sentence">
            <RubyText html={p.sentence_ruby_blanked} className="item-detail__jp ruby-hi-contrast" />
          </Field>
          <Field label="Options">
            <span className="item-detail__options">
              {p.options.map((opt, i) => (
                <span key={i} className={`item-detail__option ${i === p.answer_index ? "is-correct" : ""}`}>{opt}</span>
              ))}
            </span>
          </Field>
          {a.explanation && <Field label="Why">{a.explanation}</Field>}
        </div>
      );
    }
    case "conjugation": {
      const p = detail.prompt as ConjugationPrompt;
      const a = detail.answer as ConjugationAnswer;
      return (
        <div className="item-detail__fields">
          {p.base_ruby && (
            <Field label="Base">
              <RubyText html={p.base_ruby} className="item-detail__jp ruby-hi-contrast" />
            </Field>
          )}
          <Field label="Target form">{p.tense}</Field>
          <Field label="Answer">
            {a.expected_ruby
              ? <RubyText html={a.expected_ruby} className="item-detail__jp ruby-hi-contrast" />
              : <span className="item-detail__jp">{a.expected}</span>}
          </Field>
          {a.alternates?.length ? <Field label="Also accepted">{a.alternates.join("、")}</Field> : null}
        </div>
      );
    }
    case "reading": {
      const p = detail.prompt as ReadingPrompt;
      const a = detail.answer as ReadingAnswer;
      return (
        <div className="item-detail__fields">
          <Field label="Passage">
            <RubyText html={p.passage_ruby} className="item-detail__jp is-passage ruby-hi-contrast" />
          </Field>
          <Field label="Question">{p.question_english}</Field>
          <Field label="Answer">{a.answer_english}</Field>
          {a.answer_japanese_ruby && (
            <Field label="In Japanese">
              <RubyText html={a.answer_japanese_ruby} className="item-detail__jp ruby-hi-contrast" />
            </Field>
          )}
        </div>
      );
    }
    case "explain": {
      const p = detail.prompt as ExplainPrompt;
      const a = detail.answer as ExplainAnswer;
      return (
        <div className="item-detail__fields">
          <Field label="Task">{p.task_english}</Field>
          {p.task_japanese_ruby && (
            <Field label="In Japanese">
              <RubyText html={p.task_japanese_ruby} className="item-detail__jp ruby-hi-contrast" />
            </Field>
          )}
          <Field label="Register">{p.register}</Field>
          {p.required_connectives?.length ? (
            <Field label="Required connectives">
              <span className="item-detail__options">
                {p.required_connectives.map((c, i) => <span key={i} className="item-detail__option">{c}</span>)}
              </span>
            </Field>
          ) : null}
          {a.model_explanation_ruby && (
            <Field label="Model answer">
              <RubyText html={a.model_explanation_ruby} className="item-detail__jp is-passage ruby-hi-contrast" />
            </Field>
          )}
          {a.rubric_notes && <Field label="What a strong answer has">{a.rubric_notes}</Field>}
        </div>
      );
    }
    case "listening": {
      const p = detail.prompt as ListeningPrompt;
      const a = detail.answer as ListeningAnswer;
      return (
        <div className="item-detail__fields">
          <Field label="Clip">{p.audio_kind} · {p.jlpt_level}</Field>
          {p.audio_url && (
            <Field label="Audio">
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <audio className="item-detail__audio" src={p.audio_url} controls preload="none" />
            </Field>
          )}
          {p.questions?.map((q, i) => (
            <Field key={i} label={`Question ${i + 1}`}>
              <span className="item-detail__q">{q.question_english}</span>
              <span className="item-detail__options">
                {q.options.map((opt, oi) => (
                  <span key={oi} className={`item-detail__option ${oi === q.answer_index ? "is-correct" : ""}`}>{opt}</span>
                ))}
              </span>
            </Field>
          ))}
          {a.transcript_ruby && (
            <Field label="Transcript">
              <RubyText html={a.transcript_ruby} className="item-detail__jp is-passage ruby-hi-contrast" />
            </Field>
          )}
          {a.translation_english && <Field label="Translation">{a.translation_english}</Field>}
        </div>
      );
    }
    case "kanji": {
      const p = detail.prompt as KanjiPrompt;
      const a = detail.answer as KanjiAnswer;
      return (
        <div className="item-detail__fields">
          {a.on?.length ? <Field label="On'yomi"><span className="item-detail__jp">{a.on.join("、")}</span></Field> : null}
          {a.kun?.length ? <Field label="Kun'yomi"><span className="item-detail__jp">{a.kun.join("、")}</span></Field> : null}
          {a.stroke_count ? <Field label="Strokes">{a.stroke_count}</Field> : null}
          {!detail.front && p.character ? <Field label="Character">{p.character}</Field> : null}
        </div>
      );
    }
    default:
      return null;
  }
}

// Leitner state, in the learner's terms. An unseen card has no review_state at
// all, so box is null — say "not studied yet" rather than implying box 1.
function Progress({ detail }: { detail: ItemDetailResponse }) {
  const pct = Math.round(detail.mastery * 100);
  const date = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—";

  return (
    <div className="item-detail__progress">
      <div className="item-detail__progress-head">
        <span className="item-detail__field-label">Progress</span>
        <span className="item-detail__progress-pct">{pct}%</span>
      </div>
      <div className="item-detail__bar">
        <div className="item-detail__bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <p className="item-detail__stats">
        {detail.box == null
          ? "Not studied yet"
          : <>Box {detail.box} of 5 · {detail.total_reviews} review{detail.total_reviews === 1 ? "" : "s"} · {detail.total_missed} missed</>}
      </p>
      <p className="item-detail__stats">
        {detail.box == null
          ? <>Added {date(detail.created_at)}</>
          : <>Next review {date(detail.next_review_at)} · added {date(detail.created_at)}</>}
      </p>
    </div>
  );
}
