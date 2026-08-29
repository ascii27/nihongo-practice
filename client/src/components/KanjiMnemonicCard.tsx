import { useEffect, useState } from "react";
import type { KanjiMnemonic } from "@nihongo/shared";
import { fetchKanjiMnemonic, regenerateKanjiMnemonic } from "../api-hooks";
import { RubyText } from "./RubyText";

type Props = { character: string };

// The memory-aid face of a kanji card: one absurd scene for the meaning, then
// per reading an English sound hook, a mini-story, and a real sentence.
//
// Fetching on mount is deliberate — this component only mounts when the learner
// selects the Mnemonic tab, and the server generates on first ask, so nothing is
// spent on kanji nobody wanted help with.
export function KanjiMnemonicCard({ character }: Props) {
  const [mnemonic, setMnemonic] = useState<KanjiMnemonic | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setMnemonic(null);
    setError(null);
    fetchKanjiMnemonic(character)
      .then((m) => { if (!cancelled) setMnemonic(m); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "load failed"); });
    return () => { cancelled = true; };
  }, [character]);

  async function tryAnother() {
    setBusy(true);
    setError(null);
    try {
      setMnemonic(await regenerateKanjiMnemonic(character));
    } catch {
      setError("Couldn’t write one — try again.");
    } finally {
      setBusy(false);
    }
  }

  if (error && !mnemonic) {
    return (
      <div className="kanji-mnemonic">
        <p className="kanji-mnemonic__error">Couldn’t write a mnemonic for this one.</p>
        <button type="button" className="kanji-mnemonic__retry" onClick={tryAnother} disabled={busy}>
          {busy ? "Trying…" : "Try again"}
        </button>
      </div>
    );
  }

  if (!mnemonic) {
    return (
      <div className="kanji-mnemonic">
        <p className="kanji-mnemonic__loading">Writing a mnemonic…</p>
      </div>
    );
  }

  return (
    <div className="kanji-mnemonic">
      <section className="kanji-mnemonic__meaning">
        <p className="kanji-mnemonic__gloss">{mnemonic.meaning.gloss}</p>
        <p className="kanji-mnemonic__scene">{mnemonic.meaning.scene}</p>
        <p className="kanji-mnemonic__hook">{mnemonic.meaning.hook}</p>
      </section>

      {mnemonic.readings.map((r) => (
        <section className="kanji-mnemonic__reading" key={`${r.type}-${r.reading}`}>
          <p className="kanji-mnemonic__hookline">
            <span className="kanji-mnemonic__reading-jp">{r.reading}</span>
            <span className="kanji-mnemonic__arrow">→</span>
            <span className="kanji-mnemonic__sound">{r.sound_hook}</span>
            <span className="kanji-mnemonic__type">{r.type === "on" ? "on’yomi" : "kun’yomi"}</span>
          </p>
          <p className="kanji-mnemonic__scene">{r.scene}</p>
          <div className="kanji-mnemonic__sentence">
            <RubyText html={r.sentence.jp_ruby} className="kanji-mnemonic__jp" />
            <p className="kanji-mnemonic__en">{r.sentence.en}</p>
          </div>
          {r.note && <p className="kanji-mnemonic__note">{r.note}</p>}
        </section>
      ))}

      {mnemonic.recap.length > 0 && (
        <ul className="kanji-mnemonic__recap">
          {mnemonic.recap.map((line) => <li key={line}>{line}</li>)}
        </ul>
      )}

      <button type="button" className="kanji-mnemonic__retry" onClick={tryAnother} disabled={busy}>
        {busy ? "Writing another…" : "Try another"}
      </button>
      {error && <p className="kanji-mnemonic__error">{error}</p>}
    </div>
  );
}
