import type { ReactNode } from "react";
import { IconHome, IconStudy, IconBrowse, IconStats } from "./icons";

export type Tab = "today" | "lessons" | "study" | "stats";

type Props = {
  active: Tab;
  onChange: (tab: Tab) => void;
};

const TABS: { id: Tab; label: string; icon: ReactNode }[] = [
  { id: "today", label: "Today", icon: <IconHome /> },
  { id: "lessons", label: "Lessons", icon: <IconBrowse /> },
  { id: "study", label: "Study", icon: <IconStudy /> },
  { id: "stats", label: "Stats", icon: <IconStats /> },
];

export function BottomTabs({ active, onChange }: Props) {
  return (
    <nav className="tabbar" aria-label="Primary">
      {TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          className={`tabbar__btn ${active === t.id ? "is-active" : ""}`}
          aria-current={active === t.id ? "page" : undefined}
          onClick={() => onChange(t.id)}
        >
          <span className="tabbar__icon">{t.icon}</span>
          {t.label}
        </button>
      ))}
    </nav>
  );
}
