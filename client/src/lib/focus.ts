import type { Focus, TagSummary } from "@nihongo/shared";
import { SKILL_META } from "./skills";

const KEY = "nihongo.focus";

// The focus is remembered per device until cleared. Storage can be missing or
// throw (private mode, blocked site data), so every access is guarded and the
// fallback is "no focus".
export function loadFocus(): Focus {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const v = JSON.parse(raw) as Focus;
    return {
      ...(typeof v.skill === "string" && v.skill in SKILL_META ? { skill: v.skill } : {}),
      ...(typeof v.tag === "string" ? { tag: v.tag } : {}),
    };
  } catch {
    return {};
  }
}

export function saveFocus(f: Focus): void {
  try {
    if (!f.skill && !f.tag) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(f));
  } catch { /* storage unavailable — the focus just won't persist */ }
}

// A remembered tag may have been deleted since; drop it rather than 404.
export function sanitizeFocus(f: Focus, tags: TagSummary[]): Focus {
  if (f.tag && !tags.some((t) => t.id === f.tag)) return f.skill ? { skill: f.skill } : {};
  return f;
}

export function focusQuery(f: Focus): URLSearchParams {
  const p = new URLSearchParams();
  if (f.skill) p.set("skill", f.skill);
  if (f.tag) p.set("tag", f.tag);
  return p;
}

// "Kanji × Coto Academy", "Kanji", "Coto Academy", or null for no focus.
export function focusLabel(f: Focus, tags: TagSummary[]): string | null {
  const parts: string[] = [];
  if (f.skill) parts.push(SKILL_META[f.skill].label);
  if (f.tag) parts.push(tags.find((t) => t.id === f.tag)?.name ?? "Tag");
  return parts.length ? parts.join(" × ") : null;
}
