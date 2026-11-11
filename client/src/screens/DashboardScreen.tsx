import { useCallback, useEffect, useRef, useState } from "react";
import type { DashboardResponse, Focus, ReviewMode, TagSummary, TodayLessonResponse } from "@nihongo/shared";
import { fetchDashboard, fetchTodayLesson, unlockAnotherRound } from "../api-hooks";
import { ApiError } from "../api";
import { SKILL_ORDER, SKILL_META } from "../lib/skills";
import { focusLabel } from "../lib/focus";
import { FocusPickers } from "../components/FocusPickers";
import { IconChevron } from "../components/icons";

type Props = {
  focus: Focus;                              // {} = everything
  tags: TagSummary[];
  onFocusChange: (f: Focus) => void;
  onPractice: (mode: ReviewMode) => void;    // practises the current focus
  onOpenSettings: () => void;
  onStartLesson: (id: string) => void;
  onOpenLessons: () => void;
};

export function DashboardScreen({
  focus, tags, onFocusChange, onPractice, onOpenSettings, onStartLesson, onOpenLessons,
}: Props) {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [today, setToday] = useState<TodayLessonResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rounding, setRounding] = useState(false);
  const heroRef = useRef<HTMLElement>(null);

  // A focus on a tag that has since been deleted answers 404; drop the tag and
  // reload rather than showing an error.
  const onLoadError = useCallback((err: unknown) => {
    if (err instanceof ApiError && err.code === "TAG_NOT_FOUND") {
      onFocusChange(focus.skill ? { skill: focus.skill } : {});
      return;
    }
    setError(err instanceof Error ? err.message : "load failed");
  }, [focus.skill, onFocusChange]);

  const load = useCallback(() => {
    fetchDashboard(focus).then(setData).catch(onLoadError);
    // Keyed on the focus's parts: its owner rebuilds the object on every change.
  }, [focus.skill, focus.tag, onLoadError]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { fetchTodayLesson().then(setToday).catch(() => {}); }, []);

  // Unlocks one more full target. The response is a complete dashboard payload,
  // so it replaces state directly instead of triggering a refetch.
  async function anotherRound() {
    setRounding(true);
    try {
      setData(await unlockAnotherRound(focus));
    } catch (err) {
      setError(err instanceof Error ? err.message : "couldn't start another round");
    } finally {
      setRounding(false);
    }
  }

  if (error) return <main className="screen"><p role="alert">Couldn't load: {error}</p></main>;
  if (!data) return <main className="screen screen--centered">Loading…</main>;

  // The honest inventory across every skill, used for the "still in the deck"
  // copy and to tell an empty deck apart from a spent budget.
  const pool = SKILL_ORDER.reduce((acc, s) => acc + data.by_skill[s].due + data.by_skill[s].new, 0);
  // The hero's number is the server's session size verbatim. Deriving one here
  // is what made the hero promise cards the session then refused to deal: the
  // new-card share is invisible from out here, so `min(remaining, pool)` reads
  // 30 against a 300-card new deck that yields 10.
  const heroCount = data.session_size;
  // Another round raises the allowance and the new-card share together, but it
  // cannot conjure cards. Only offer it when the server says it would deal some
  // — an unlock that lands on an empty session is the same broken promise in a
  // slower form. Both hero states that can offer a round share this button.
  //
  // The label counts cards, not allowance. `daily_target` is what a round adds
  // to the budget, which is not what the round hands you: on an all-new deck
  // with the day's share spent, +30 of allowance yields a 10-card session. The
  // button has to state the session, for the same reason the hero does.
  const canRound = data.another_round_size > 0;
  const roundButton = canRound ? (
    <button
      type="button" className="cta cta--primary cta--lg today__hero-cta"
      onClick={anotherRound} disabled={rounding}
    >
      {rounding ? "Dealing another round…" : `Go another round (+${data.another_round_size})`}
    </button>
  ) : null;
  const label = focusLabel(focus, tags);
  const lastLabel = data.last_practiced_at
    ? new Date(data.last_practiced_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : "never";

  return (
    <main className="screen today">
      <header className="topbar">
        <h1 className="topbar__title">Today</h1>
        <button type="button" className="topbar__action" onClick={onOpenSettings}>Settings</button>
      </header>

      {today?.lesson ? (
        <button type="button" className="today-hero-lesson" onClick={() => onStartLesson(today.lesson!.id)}>
          <span className="today-hero-lesson__kicker">Today's lesson</span>
          <span className="today-hero-lesson__title">{today.lesson.title}</span>
          <span className="today-hero-lesson__meta">
            {today.lesson.jlpt_level} · {today.lesson.item_count} items · {today.lesson.progress === "in_progress" ? "Resume" : "Start"} →
          </span>
        </button>
      ) : (
        <button type="button" className="today-hero-lesson today-hero-lesson--empty" onClick={onOpenLessons}>
          <span className="today-hero-lesson__kicker">Today's lesson</span>
          <span className="today-hero-lesson__title">{today?.generating ? "Preparing your lesson…" : "Create a lesson →"}</span>
        </button>
      )}

      <div className="today__streak">
        <span className="today__streak-flame">日</span>
        <span><span className="today__streak-num">{data.streak_days}</span>-day streak</span>
        <span className="today__streak-sep">·</span>
        <span>last practice {lastLabel}</span>
      </div>

      {/* Four states, in this order. An empty deck reads as 全部終わり before
          anything else, so it can never offer work that does not exist. A met
          target then takes precedence over a backlog — that is the whole point
          of the target. Only after both does the awkward case appear: budget
          left, cards left, but the day's new-card share spent and nothing due,
          which is the one shape where a session would come back empty. The
          number shown is `session_size` in every state, so it always equals
          what "Start mixed practice" will deal. */}
      <section className="today__hero" ref={heroRef}>
        <FocusPickers focus={focus} tags={tags} onChange={onFocusChange} />
        {label && (
          <button type="button" className="focus-chip" onClick={() => onFocusChange({})}
                  aria-label={`Clear focus ${label}`}>
            {label} <span aria-hidden="true">×</span>
          </button>
        )}
        {/* A focus that yields no session gets its own state first: the
            unfocused copy below talks about the whole deck, which is not what
            was asked. It offers a drill of everything in the focus — outside
            the schedule — and another round when one would deal cards. */}
        {label && data.session_size === 0 ? (
          <>
            <p className="today__hero-label">Ready to review</p>
            <p className="today__hero-count">0</p>
            <p className="today__hero-done-sub">Nothing due in {label}.</p>
            {data.drill_available > 0 && (
              <button type="button" className="cta cta--primary cta--lg today__hero-cta"
                      onClick={() => onPractice("drill")}>
                Drill all {data.drill_available} anyway
              </button>
            )}
            {roundButton}
          </>
        ) : pool === 0 ? (
          <>
            <p className="today__hero-label">Ready to review</p>
            <p className="today__hero-count">0</p>
            <p className="today__hero-empty">全部終わり — all caught up. Generate more in Settings.</p>
          </>
        ) : data.remaining === 0 ? (
          <>
            <p className="today__hero-label">Today's target</p>
            <p className="today__hero-done">今日の分、終わり</p>
            <p className="today__hero-done-sub">
              {data.reviewed_today} reviewed today — you're done.{" "}
              {canRound
                ? `${pool} still in the deck whenever you want them.`
                : `${pool} still in the deck, ready tomorrow.`}
            </p>
            {roundButton}
          </>
        ) : data.session_size === 0 ? (
          <>
            <p className="today__hero-label">Ready to review</p>
            <p className="today__hero-count">0</p>
            {/* `today__hero-done-sub`, not `today__hero-empty`: this copy is
                English sub-copy above a CTA, which is what that class is built
                for. `hero-empty` sets the Japanese face at 20px with no bottom
                margin — right for state 1's short phrase, wrong here. */}
            <p className="today__hero-done-sub">
              Today's new cards are done and nothing else is due.{" "}
              {canRound
                ? `${pool} still in the deck — another round pulls more in.`
                : `${pool} still in the deck, ready tomorrow.`}
            </p>
            {roundButton}
          </>
        ) : (
          <>
            <p className="today__hero-label">Ready to review</p>
            <p className="today__hero-count">{heroCount}</p>
            <p className="today__hero-sub">
              {label
                ? <>cards · {label}</>
                : <>cards across all skills &nbsp;·&nbsp; <span className="jp">混合練習</span></>}
            </p>
            <button type="button" className="cta cta--primary cta--lg today__hero-cta" onClick={() => onPractice("scheduled")}>
              {label ? "Start focused practice" : "Start mixed practice"}
            </button>
          </>
        )}
      </section>

      <h2 className="today__section-title">Skills</h2>
      <div className="today__skill-list">
        {SKILL_ORDER.map((s) => {
          const { due, new: n } = data.by_skill[s];
          const total = due + n;
          const meta = SKILL_META[s];
          return (
            <button
              key={s} type="button" className={`today__skill-row skill-card--${s}`}
              onClick={() => {
                // A skill row focuses the hero on that skill (keeping any tag);
                // the session itself starts from the hero.
                onFocusChange({ ...focus, skill: s });
                heroRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
            >
              <span className="today__skill-glyph">{meta.short}</span>
              <span className="today__skill-meta">
                <span className="today__skill-name">{meta.label}</span>
                <span className="today__skill-counts">
                  {total > 0 ? <>{due} due · {n} new</> : <span className="empty">all caught up</span>}
                </span>
              </span>
              <span className={`today__skill-num ${total === 0 ? "is-zero" : ""}`}>{total}</span>
              <span className="today__skill-chev"><IconChevron /></span>
            </button>
          );
        })}
      </div>
    </main>
  );
}
