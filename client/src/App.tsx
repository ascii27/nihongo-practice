import { useCallback, useEffect, useState } from "react";
import type { Focus, TagSummary } from "@nihongo/shared";
import type { PracticeKind } from "./lib/practice";
import type { TodaySection, TodayTarget } from "./lib/today";
import { auth } from "./auth";
import { api } from "./api";
import { fetchTags } from "./api-hooks";
import { loadFocus, saveFocus, sanitizeFocus } from "./lib/focus";
import { PasscodeScreen } from "./screens/PasscodeScreen";
import { DashboardScreen } from "./screens/DashboardScreen";
import { LessonsScreen } from "./screens/LessonsScreen";
import { LessonWalkthroughScreen } from "./screens/LessonWalkthroughScreen";
import { PracticeScreen } from "./screens/PracticeScreen";
import { StatsScreen } from "./screens/StatsScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { LibraryScreen } from "./screens/LibraryScreen";
import { BottomTabs, type Tab } from "./components/BottomTabs";

type AuthState = "checking" | "needs-auth" | "authed";
// `practice` (the card-playing engine) has no tab of its own; it plays the
// current focus as the day's session or as a drill, or the whole deck (SRS).
type Route = Tab | "settings" | "lesson" | "practice";

export default function App() {
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [route, setRoute] = useState<Route>("today");
  const [lessonId, setLessonId] = useState<string | null>(null);
  // The Ready-for-Review focus lives here so Library's "Review this tag" can
  // set it, and it is remembered per device until cleared.
  const [focus, setFocus] = useState<Focus>(loadFocus);
  const [practiceMode, setPracticeMode] = useState<PracticeKind>("scheduled");
  const [tags, setTags] = useState<TagSummary[]>([]);
  // Set only by a hand-off from Library's skill view and cleared by any other
  // navigation, so coming back to Today later doesn't scroll again.
  const [todayTarget, setTodayTarget] = useState<TodayTarget | null>(null);
  function go(r: Route) { setTodayTarget(null); setRoute(r); }
  function openToday(section: TodaySection, f: Focus) {
    setTodayTarget((t) => ({ section, skill: f.skill, tag: f.tag, nonce: (t?.nonce ?? 0) + 1 }));
    setRoute("today");
  }

  useEffect(() => {
    if (!auth.get()) { setAuthState("needs-auth"); return; }
    api("/api/auth/check", { method: "POST", body: "{}" })
      .then(() => setAuthState("authed"))
      .catch(() => setAuthState("needs-auth"));
  }, []);

  const refreshTags = useCallback(() => {
    fetchTags()
      .then((r) => {
        setTags(r.tags);
        setFocus((f) => sanitizeFocus(f, r.tags));
      })
      .catch(() => {});
  }, []);
  useEffect(() => { if (authState === "authed") refreshTags(); }, [authState, refreshTags]);
  useEffect(() => { saveFocus(focus); }, [focus]);

  if (authState === "checking") return <main className="screen screen--centered">Loading…</main>;
  if (authState === "needs-auth") return <PasscodeScreen onAuthed={() => setAuthState("authed")} />;

  let active;
  if (route === "today") {
    active = (
      <DashboardScreen
        focus={focus}
        tags={tags}
        onFocusChange={setFocus}
        onPractice={(mode) => { setPracticeMode(mode); go("practice"); }}
        onOpenSettings={() => go("settings")}
        onStartLesson={(id) => { setLessonId(id); go("lesson"); }}
        onOpenLessons={() => go("lessons")}
        onTagsChanged={refreshTags}
        target={todayTarget}
      />
    );
  } else if (route === "lessons") {
    active = <LessonsScreen onOpenLesson={(id) => { setLessonId(id); setRoute("lesson"); }} />;
  } else if (route === "lesson") {
    active = lessonId
      ? <LessonWalkthroughScreen lessonId={lessonId} onExit={() => go("today")} />
      : <LessonsScreen onOpenLesson={(id) => { setLessonId(id); setRoute("lesson"); }} />;
  } else if (route === "practice") {
    active = (
      <PracticeScreen
        focus={focus}
        mode={practiceMode}
        onDone={() => { refreshTags(); go("today"); }}
      />
    );
  } else if (route === "library") {
    active = (
      <LibraryScreen
        tags={tags}
        onTagsChanged={refreshTags}
        onReviewTag={(id) => { setFocus({ tag: id }); openToday("practice", {}); }}
        onStudy={(f) => { setFocus(f); openToday("practice", f); }}
        onAdd={(f) => openToday("add", f)}
      />
    );
  } else if (route === "stats") {
    active = <StatsScreen />;
  } else {
    active = (
      <SettingsScreen
        onSignOut={() => setAuthState("needs-auth")}
        onBack={() => go("today")}
      />
    );
  }

  // The tab bar is hidden on full-bleed screens (practice) and sub-pages.
  const fullBleed = route === "practice" || route === "settings" || route === "lesson";
  const tab: Tab = route === "settings" || route === "lesson" || route === "practice" ? "today" : route;

  return (
    <div className="app dir-ink">
      {active}
      {!fullBleed && <BottomTabs active={tab} onChange={(t) => go(t)} />}
    </div>
  );
}
