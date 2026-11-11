import type { Focus, Skill, TagSummary } from "@nihongo/shared";
import { SKILL_ORDER, SKILL_META } from "../lib/skills";

type Props = { focus: Focus; tags: TagSummary[]; onChange: (f: Focus) => void };

// The two optional narrowing controls shared by Today's hero and Library: one
// skill and one tag, each defaulting to "All".
export function FocusPickers({ focus, tags, onChange }: Props) {
  function set(next: Focus) {
    onChange({
      ...(next.skill ? { skill: next.skill } : {}),
      ...(next.tag ? { tag: next.tag } : {}),
    });
  }
  return (
    <div className="focus-pickers">
      <label className="focus-pickers__field">
        <span className="focus-pickers__label">Skill</span>
        <select
          className="focus-pickers__select"
          value={focus.skill ?? ""}
          onChange={(e) => set({ ...focus, skill: (e.target.value || undefined) as Skill | undefined })}
        >
          <option value="">All</option>
          {SKILL_ORDER.map((s) => <option key={s} value={s}>{SKILL_META[s].label}</option>)}
        </select>
      </label>
      <label className="focus-pickers__field">
        <span className="focus-pickers__label">Tag</span>
        <select
          className="focus-pickers__select"
          value={focus.tag ?? ""}
          onChange={(e) => set({ ...focus, tag: e.target.value || undefined })}
        >
          <option value="">All</option>
          {tags.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.item_count})</option>)}
        </select>
      </label>
    </div>
  );
}
