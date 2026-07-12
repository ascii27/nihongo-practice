import { useEffect, useState } from "react";
import type { Skill } from "@nihongo/shared";
import { auth } from "./auth";
import { api } from "./api";
import { PasscodeScreen } from "./screens/PasscodeScreen";
import { DashboardScreen } from "./screens/DashboardScreen";
import { LessonsScreen } from "./screens/LessonsScreen";
import { LessonWalkthroughScreen } from "./screens/LessonWalkthroughScreen";
import { PracticeScreen } from "./screens/PracticeScreen";
import { StatsScreen } from "./screens/StatsScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { BottomTabs, type Tab } from "./components/BottomTabs";

type AuthState = "checking" | "needs-auth" | "authed";
type Route = Tab | "settings" | "lesson";

export default function App() {
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [route, setRoute] = useState<Route>("today");
  const [practiceSkill, setPracticeSkill] = useState<Skill | undefined>(undefined);
  const [lessonId, setLessonId] = useState<string | null>(null);

  useEffect(() => {
    if (!auth.get()) { setAuthState("needs-auth"); return; }
    api("/api/auth/check", { method: "POST", body: "{}" })
      .then(() => setAuthState("authed"))
      .catch(() => setAuthState("needs-auth"));
  }, []);

  if (authState === "checking") return <main className="screen screen--centered">Loading…</main>;
  if (authState === "needs-auth") return <PasscodeScreen onAuthed={() => setAuthState("authed")} />;

  let active;
  if (route === "today") {
    active = (
      <DashboardScreen
        onPractice={(skill) => { setPracticeSkill(skill); setRoute("practice"); }}
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
    active = <PracticeScreen skill={practiceSkill} onDone={() => setRoute("today")} />;
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

  // The tab bar is hidden during full-bleed practice and the Settings sub-page.
  const showTabs = route !== "practice" && route !== "settings" && route !== "lesson";
  const tab: Tab = route === "settings" || route === "lesson" ? "today" : route;

  return (
    <div className="app dir-ink">
      {active}
      {showTabs && <BottomTabs active={tab} onChange={(t) => setRoute(t)} />}
    </div>
  );
}
