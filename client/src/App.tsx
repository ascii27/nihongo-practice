import { useEffect, useState } from "react";
import { auth } from "./auth";
import { api, AuthError } from "./api";
import { PasscodeScreen } from "./screens/PasscodeScreen";
import { TodayScreen } from "./screens/TodayScreen";

type State = "checking" | "needs-auth" | "authed";

export default function App() {
  const [state, setState] = useState<State>("checking");

  useEffect(() => {
    if (!auth.get()) {
      setState("needs-auth");
      return;
    }
    api("/api/auth/check", { method: "POST", body: "{}" })
      .then(() => setState("authed"))
      .catch((err) => {
        if (err instanceof AuthError) setState("needs-auth");
        else setState("needs-auth"); // fall back to passcode screen on any failure
      });
  }, []);

  if (state === "checking") return <main className="screen screen--centered">Loading…</main>;
  if (state === "needs-auth") return <PasscodeScreen onAuthed={() => setState("authed")} />;
  return <TodayScreen onSignOut={() => setState("needs-auth")} />;
}
