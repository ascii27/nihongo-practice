import { useCallback, useEffect, useState } from "react";
import type { Focus, ReviewMode, TagSummary } from "@nihongo/shared";
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
// current focus, either as the day's session or as a drill.
type Route = Tab | "settings" | "lesson" | "practice";

export default function App() {
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [route, setRoute] = useState<Route>("today");
  const [lessonId, setLessonId] = useState<string | null>(null);
  // The Ready-for-Review focus lives here so Library's "Review this tag" can
  // set it, and it is remembered per device until cleared.
  const [focus, setFocus] = useState<Focus>(loadFocus);
  const [practiceMode, setPracticeMode] = useState<ReviewMode>("scheduled");
  const [tags, setTags] = useState<TagSummary[]>([]);

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
        onPractice={(mode) => { setPracticeMode(mode); setRoute("practice"); }}
        onOpenSettings={() => setRoute("settings")}
        onStartLesson={(id) => { setLessonId(id); setRoute("lesson"); }}
        onOpenLessons={() => setRoute("lessons")}
      />
    );
  } else if (route === "lessons") {
    active = <LessonsScreen onOpenLesson={(id) => { setLessonId(id); setRoute("lesson"); }} />;
  } else if (route === "lesson") {
    active = lessonId
      ? <LessonWalkthroughScreen lessonId={lessonId} onExit={() => setRoute("today")} />
      : <LessonsScreen onOpenLesson={(id) => { setLessonId(id); setRoute("lesson"); }} />;
  } else if (route === "practice") {
    active = (
      <PracticeScreen
        focus={focus}
        mode={practiceMode}
        onDone={() => { refreshTags(); setRoute("today"); }}
      />
    );
  } else if (route === "library") {
    active = (
      <LibraryScreen
        tags={tags}
        onTagsChanged={refreshTags}
        onReviewTag={(id) => { setFocus({ tag: id }); setRoute("today"); }}
      />
    );
  } else if (route === "stats") {
    active = <StatsScreen />;
  } else {
    active = (
      <SettingsScreen
        onSignOut={() => setAuthState("needs-auth")}
        onBack={() => setRoute("today")}
      />
    );
  }

  // The tab bar is hidden on full-bleed screens (practice) and sub-pages.
  const fullBleed = route === "practice" || route === "settings" || route === "lesson";
  const tab: Tab = route === "settings" || route === "lesson" || route === "practice" ? "today" : route;

  return (
    <div className="app dir-ink">
      {active}
      {!fullBleed && <BottomTabs active={tab} onChange={(t) => setRoute(t)} />}
    </div>
  );
}
