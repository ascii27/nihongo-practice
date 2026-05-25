import { useEffect, useMemo, useState } from "react";
import type { LibraryResponse, LibraryItem } from "@nihongo/shared";
import { fetchLibrary } from "../api-hooks";
import { SKILL_ORDER, SKILL_META } from "../lib/skills";
import { IconSearch } from "../components/icons";

export function BrowseScreen() {
  const [data, setData] = useState<LibraryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetchLibrary()
      .then((d) => { if (!cancelled) setData(d); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "load failed"); });
    return () => { cancelled = true; };
  }, []);

  const q = query.trim().toLowerCase();
  const match = (it: LibraryItem) =>
    !q ||
    it.front.toLowerCase().includes(q) ||
    (it.reading ?? "").toLowerCase().includes(q) ||
    it.meaning.toLowerCase().includes(q);

  const sections = useMemo(() => {
    if (!data) return [];
    return SKILL_ORDER.map((s) => {
      const group = data.by_skill[s];
      const items = group.items.filter(match);
      // When searching, counts/progress reflect the visible subset; otherwise
      // use the server's true totals (items are a capped sample).
      const count = q ? items.length : group.count;
      const avg = q
        ? (items.length ? items.reduce((a, i) => a + i.mastery, 0) / items.length : 0)
        : group.avg_mastery;
      return { skill: s, items, count, avg };
    }).filter((sec) => sec.items.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, q]);

  if (error) return <main className="screen browse"><div className="browse__empty" role="alert">Couldn't load: {error}</div></main>;
  if (!data) return <main className="screen screen--centered">Loading…</main>;

  const totalItems = SKILL_ORDER.reduce((acc, s) => acc + data.by_skill[s].count, 0);

  return (
    <main className="screen browse">
      <header className="topbar">
        <h1 className="topbar__title">Library</h1>
      </header>

      <div className="browse__search">
        <span className="browse__search-icon"><IconSearch /></span>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search vocab, grammar, kanji…"
          aria-label="Search library"
        />
      </div>

      {totalItems === 0 ? (
        <div className="browse__empty">Your library is empty. Generate cards from Settings to start.</div>
      ) : sections.length === 0 ? (
        <div className="browse__empty">No matches for “{query.trim()}”.</div>
      ) : (
        sections.map(({ skill, items, count, avg }) => {
          const pct = Math.round(avg * 100);
          return (
            <section key={skill} className="browse__skill-section">
              <div className="browse__skill-header">
                <h2 className="browse__skill-name">{SKILL_META[skill].label}</h2>
                <span className="browse__skill-count">{count}</span>
                <div className="browse__skill-progress">
                  <div className="browse__skill-progress-fill" style={{ width: `${pct}%` }} />
                </div>
                <span className="browse__skill-pct">{pct}%</span>
              </div>
              <div className="browse__list">
                {items.map((it) => (
                  <div key={it.id} className="browse__item">
                    <div className="browse__item-front">
                      {it.front}
                      {it.reading && <span className="browse__item-reading">{it.reading}</span>}
                    </div>
                    <div className="browse__item-meaning">{it.meaning}</div>
                    <div className="browse__item-mastery">
                      <div className="browse__item-bar">
                        <div className="browse__item-bar-fill" style={{ width: `${Math.round(it.mastery * 100)}%` }} />
                      </div>
                      <div className="browse__item-pct">{Math.round(it.mastery * 100)}%</div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          );
        })
      )}
    </main>
  );
}
