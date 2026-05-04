import { useState } from "react";
import { auth } from "../auth";
import { api, AuthError } from "../api";

export function PasscodeScreen({ onAuthed }: { onAuthed: () => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    auth.set(value);
    try {
      await api("/api/auth/check", { method: "POST", body: "{}" });
      onAuthed();
    } catch (err) {
      auth.clear();
      setError(err instanceof AuthError ? "Wrong passcode" : "Couldn't reach server");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="screen screen--centered">
      <form onSubmit={submit} className="passcode-form">
        <h1>Nihongo</h1>
        <label>
          <span>Passcode</span>
          <input
            type="password"
            inputMode="text"
            autoComplete="current-password"
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </label>
        {error && <p role="alert" className="error">{error}</p>}
        <button type="submit" disabled={busy || value.length === 0}>
          {busy ? "Checking…" : "Enter"}
        </button>
      </form>
    </main>
  );
}
