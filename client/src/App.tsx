import { useEffect, useState } from "react";
import { auth } from "./auth";
import { api } from "./api";
import { PasscodeScreen } from "./screens/PasscodeScreen";
import { TodayScreen } from "./screens/TodayScreen";
import { PracticeScreen } from "./screens/PracticeScreen";
import { BrowseScreen } from "./screens/BrowseScreen";
import { StatsScreen } from "./screens/StatsScreen";
import { BottomTabs, type Tab } from "./components/BottomTabs";

type AuthState = "checking" | "needs-auth" | "authed";

export default function App() {
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [tab, setTab] = useState<Tab>("today");

  useEffect(() => {
    if (!auth.get()) { setAuthState("needs-auth"); return; }
    api("/api/auth/check", { method: "POST", body: "{}" })
      .then(() => setAuthState("authed"))
      .catch(() => setAuthState("needs-auth"));
  }, []);

  if (authState === "checking") return <main className="screen screen--centered">Loading…</main>;
  if (authState === "needs-auth") return <PasscodeScreen onAuthed={() => setAuthState("authed")} />;

  let active;
  if (tab === "today")    active = <TodayScreen onSignOut={() => setAuthState("needs-auth")} onStartReview={() => setTab("practice")} />;
  else if (tab === "practice") active = <PracticeScreen onDone={() => setTab("today")} />;
  else if (tab === "browse")   active = <BrowseScreen />;
  else                        active = <StatsScreen />;

  return (
    <div className="app">
      {active}
      <BottomTabs active={tab} onChange={setTab} />
    </div>
  );
}
