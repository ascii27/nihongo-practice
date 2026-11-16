import { useCallback, useEffect, useRef, useState } from "react";
import type { DashboardResponse, Focus, TagSummary, TodayLessonResponse } from "@nihongo/shared";
import { fetchDashboard, fetchTodayLesson, unlockAnotherRound } from "../api-hooks";
import { ApiError } from "../api";
import { SKILL_ORDER } from "../lib/skills";
import { focusLabel } from "../lib/focus";
import { FocusPickers } from "../components/FocusPickers";
import { GenerateForm } from "../components/GenerateForm";
import { ManualItemForm } from "../components/ManualItemForm";
import { IconChevron, IconCycle, IconDaily, IconStudy } from "../components/icons";
import { loadHeroTab, saveHeroTab, type HeroTab, type PracticeKind } from "../lib/practice";
import { canGenerate, loadAddTab, saveAddTab, type AddTab, type TodayTarget } from "../lib/today";

type Props = {
  focus: Focus;                              // {} = everything
  tags: TagSummary[];
  onFocusChange: (f: Focus) => void;
  onPractice: (kind: PracticeKind) => void;  // scheduled/drill play the focus; srs the whole deck
  onOpenSettings: () => void;
  onStartLesson: (id: string) => void;
  onOpenLessons: () => void;
  // A hand-off from Library's skill view: scroll to that hero, and for "add"
  // preset the generator to the skill.
  target: TodayTarget | null;
};

export function DashboardScreen({
  focus, tags, onFocusChange, onPractice, onOpenSettings, onStartLesson, onOpenLessons, target,
}: Props) {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [today, setToday] = useState<TodayLessonResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rounding, setRounding] = useState(false);
  const [tab, setTab] = useState<HeroTab>(loadHeroTab);
  function chooseTab(t: HeroTab) { setTab(t); saveHeroTab(t); }
  const heroRef = useRef<HTMLElement>(null);
  const addRef = useRef<HTMLElement>(null);
  // A hand-off asking for Generate opens that tab without remembering it: the
  // remembered tab is the learner's own choice, not Library's.
  const [addTab, setAddTab] = useState<AddTab>(() =>
    target?.section === "add" && target.skill && canGenerate(target.skill) ? "generate" : loadAddTab());
  function chooseAddTab(t: AddTab) { setAddTab(t); saveAddTab(t); }
  // Bumped when a card lands from the add hero, so the practice hero's number
  // takes it in without a trip away and back.
  const [reloadTick, setReloadTick] = useState(0);
  const bumpReload = useCallback(() => setReloadTick((n) => n + 1), []);

  // A focus on a tag that has since been deleted answers 404; drop the tag and
  // reload rather than showing an error.
  const onLoadError = useCallback((err: unknown) => {
    if (err instanceof ApiError && err.code === "TAG_NOT_FOUND") {
      onFocusChange(focus.skill ? { skill: focus.skill } : {});
      return;
    }
    setError(err instanceof Error ? err.message : "load failed");
  }, [focus.skill, onFocusChange]);

  // Only the latest focus's response may land: a slow answer for the previous
  // focus would otherwise put its number under the new label — the hero
  // promising a session that "Start" then doesn't deal. Keyed on the focus's
  // parts, because its owner rebuilds the object on every change.
  useEffect(() => {
    let cancelled = false;
    fetchDashboard(focus)
      .then((d) => { if (!cancelled) { setData(d); setError(null); } })
      .catch((err) => { if (!cancelled) onLoadError(err); });
    return () => { cancelled = true; };
  }, [focus.skill, focus.tag, onLoadError, reloadTick]);
  useEffect(() => { fetchTodayLesson().then(setToday).catch(() => {}); }, []);

  // Apply a hand-off once the screen has content to scroll to. Keyed on the
  // nonce, so it runs once per hand-off rather than on every refetch.
  const loaded = data !== null;
  const targetNonce = target?.nonce;
  useEffect(() => {
    if (!loaded || !target) return;
    if (target.section === "practice") {
      setTab("daily");
      saveHeroTab("daily");
      heroRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    } else {
      if (target.skill && canGenerate(target.skill)) setAddTab("generate");
      addRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    // Only the nonce: `target` itself is a new object on each hand-off.
  }, [loaded, targetNonce]);

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

  // The SRS tab: the whole deck on the Leitner schedule. No focus and no daily
  // target — every due card, plus what is left of today's new-card share.
  //
  // The big number is everything the tab has to cover (`by_skill` is unfocused,
  // so its due total is the whole deck), not one sitting: with the 200-card cap
  // a 235-due deck read "200" before and after a session, so progress was
  // invisible. When the cap bites, the button names the sitting instead
  // ("Review 200" — the server's `srs_size`, exactly what it deals).
  const totalDue = SKILL_ORDER.reduce((acc, s) => acc + data.by_skill[s].due, 0);
  const srsCapped = totalDue > data.srs_due;
  const srsPanel = data.srs_size === 0 ? (
    <>
      <p className="today__hero-label">Due across your deck</p>
      <p className="today__hero-count">0</p>
      <p className="today__hero-done-sub">
        {pool === 0
          ? <>Nothing in the deck yet. Add some below.</>
          : <>Nothing is due right now, and today's new cards are in. Come back when the schedule brings cards round again.</>}
      </p>
    </>
  ) : (
    <>
      <p className="today__hero-label">Due across your deck</p>
      <p className="today__hero-count">{totalDue + data.srs_new}</p>
      <p className="today__hero-sub">
        {srsCapped ? <>{data.srs_due} per session</> : <>{data.srs_due} due</>}
        {data.srs_new > 0 && <> · {data.srs_new} new</>}
        &nbsp;·&nbsp; <span className="jp">全体復習</span>
      </p>
      <button type="button" className="cta cta--primary cta--lg today__hero-cta" onClick={() => onPractice("srs")}>
        {srsCapped ? `Review ${data.srs_size}` : "Start SRS review"}
      </button>
    </>
  );

  return (
    <main className="screen today">
      <header className="topbar">
        <h1 className="topbar__title">Today</h1>
        <button type="button" className="topbar__action" onClick={onOpenSettings}>Settings</button>
      </header>

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
      <section className="today__hero" ref={heroRef} aria-label="Practice">
        <div className="hero-tabs" role="tablist" aria-label="Practice">
          <button type="button" role="tab" id="hero-tab-daily" aria-controls="hero-panel"
                  aria-selected={tab === "daily"} className={`hero-tabs__tab ${tab === "daily" ? "is-active" : ""}`}
                  onClick={() => chooseTab("daily")}>
            <IconDaily className="hero-tabs__icon" /> Daily
          </button>
          <button type="button" role="tab" id="hero-tab-srs" aria-controls="hero-panel"
                  aria-selected={tab === "srs"} className={`hero-tabs__tab ${tab === "srs" ? "is-active" : ""}`}
                  onClick={() => chooseTab("srs")}>
            <IconCycle className="hero-tabs__icon" /> SRS
          </button>
        </div>
        <div className="hero-panel" id="hero-panel" role="tabpanel" aria-labelledby={`hero-tab-${tab}`}>
        {tab === "srs" ? srsPanel : (<>
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
            <p className="today__hero-done-sub">
              {data.remaining === 0
                ? <>Today's target is done — {data.reviewed_today} reviewed.</>
                : <>Nothing due in {label}.</>}
            </p>
            {data.drill_available > 0 && (
              <button type="button" className="cta cta--primary cta--lg today__hero-cta"
                      onClick={() => onPractice("drill")}>
                {/* Without a tag the drill is capped (a 50-card sample), so
                    "all" would be a promise it doesn't keep. */}
                {!focus.tag && data.drill_available >= 50
                  ? `Drill ${data.drill_available} anyway`
                  : `Drill all ${data.drill_available} anyway`}
              </button>
            )}
            {roundButton}
          </>
        ) : pool === 0 ? (
          <>
            <p className="today__hero-label">Ready to review</p>
            <p className="today__hero-count">0</p>
            <p className="today__hero-empty">全部終わり — all caught up. Add more below.</p>
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
        </>)}
        </div>
      </section>

      {/* The second of Today's two jobs: putting new cards in. Library's skill
          view lands here with the generator preset to that skill. */}
      <section className="today__hero today__add" ref={addRef} aria-label="Add cards">
        <p className="today__hero-label">Add to your deck</p>
        <div className="hero-tabs" role="tablist" aria-label="Add cards">
          <button type="button" role="tab" id="add-tab-word" aria-controls="add-panel"
                  aria-selected={addTab === "word"} className={`hero-tabs__tab ${addTab === "word" ? "is-active" : ""}`}
                  onClick={() => chooseAddTab("word")}>
            Add a word
          </button>
          <button type="button" role="tab" id="add-tab-generate" aria-controls="add-panel"
                  aria-selected={addTab === "generate"} className={`hero-tabs__tab ${addTab === "generate" ? "is-active" : ""}`}
                  onClick={() => chooseAddTab("generate")}>
            Generate
          </button>
        </div>
        <div className="hero-panel" id="add-panel" role="tabpanel" aria-labelledby={`add-tab-${addTab}`}>
          {addTab === "word" ? (
            <ManualItemForm onSaved={bumpReload} />
          ) : (
            <GenerateForm
              key={target?.nonce ?? 0}
              mode="full"
              defaultSkill={target?.section === "add" && target.skill && canGenerate(target.skill) ? target.skill : undefined}
              onSuccess={bumpReload}
            />
          )}
        </div>
      </section>

      {/* Today's lesson, compact: the two heroes above are the day's main actions. */}
      {today?.lesson ? (
        <button type="button" className="today-lesson" onClick={() => onStartLesson(today.lesson!.id)}>
          <span className="today-lesson__icon"><IconStudy /></span>
          <span className="today-lesson__body">
            <span className="today-lesson__kicker">Today's lesson</span>
            <span className="today-lesson__title">{today.lesson.title}</span>
            <span className="today-lesson__meta">
              {today.lesson.jlpt_level} · {today.lesson.item_count} items · {today.lesson.progress === "in_progress" ? "Resume" : "Start"}
            </span>
          </span>
          <span className="today-lesson__chev"><IconChevron /></span>
        </button>
      ) : (
        <button type="button" className="today-lesson today-lesson--empty" onClick={onOpenLessons}>
          <span className="today-lesson__icon"><IconStudy /></span>
          <span className="today-lesson__body">
            <span className="today-lesson__kicker">Today's lesson</span>
            <span className="today-lesson__title">{today?.generating ? "Preparing your lesson…" : "Create a lesson"}</span>
          </span>
          <span className="today-lesson__chev"><IconChevron /></span>
        </button>
      )}

    </main>
  );
}
