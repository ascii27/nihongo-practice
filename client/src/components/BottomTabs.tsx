export type Tab = "today" | "practice" | "browse" | "stats";

type Props = {
  active: Tab;
  onChange: (tab: Tab) => void;
};

const TABS: { id: Tab; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "practice", label: "Practice" },
  { id: "browse", label: "Browse" },
  { id: "stats", label: "Stats" },
];

export function BottomTabs({ active, onChange }: Props) {
  return (
    <nav className="tabs" aria-label="Primary">
      {TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          className={`tabs__btn ${active === t.id ? "is-active" : ""}`}
          aria-current={active === t.id ? "page" : undefined}
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </nav>
  );
}
