import { useEffect, useState } from "react";
import { auth } from "./auth";
import { api } from "./api";
import { PasscodeScreen } from "./screens/PasscodeScreen";
import { TodayScreen } from "./screens/TodayScreen";
import { PracticeScreen } from "./screens/PracticeScreen";
import { BrowseScreen } from "./screens/BrowseScreen";
import { StatsScreen } from "./screens/StatsScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { BottomTabs, type Tab } from "./components/BottomTabs";

type AuthState = "checking" | "needs-auth" | "authed";
type Route = Tab | "settings";

export default function App() {
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [route, setRoute] = useState<Route>("today");

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
      <TodayScreen
        onStartReview={() => setRoute("practice")}
        onOpenSettings={() => setRoute("settings")}
      />
    );
  } else if (route === "practice") {
    active = <PracticeScreen onDone={() => setRoute("today")} />;
  } else if (route === "browse") {
    active = <BrowseScreen />;
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

  const tab: Tab = route === "settings" ? "today" : route;

  return (
    <div className="app">
      {active}
      <BottomTabs active={tab} onChange={(t) => setRoute(t)} />
    </div>
  );
}
