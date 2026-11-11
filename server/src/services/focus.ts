// One definition of "what a focus selects", shared by the queue, the dashboard
// and the library so the hero, the session and Library can never disagree
// about which cards a focus covers.
import { Focus, type Focus as FocusT } from "@nihongo/shared";
import { tagExists } from "./tags.js";

export function hasFocus(f: FocusT): boolean {
  return f.skill !== undefined || f.tag !== undefined;
}

// SQL conditions (each starting with ` AND `) restricting the items alias to
// the focus. Parameters are numbered from `firstParam`, skill before tag.
export function focusClause(f: FocusT, firstParam: number, alias = "i"): { sql: string; params: unknown[] } {
  let sql = "";
  const params: unknown[] = [];
  if (f.skill !== undefined) {
    params.push(f.skill);
    sql += ` AND ${alias}.skill = $${firstParam + params.length - 1}`;
  }
  if (f.tag !== undefined) {
    params.push(f.tag);
    sql += ` AND EXISTS (SELECT 1 FROM item_tags ft WHERE ft.item_id = ${alias}.id AND ft.tag_id = $${firstParam + params.length - 1})`;
  }
  return { sql, params };
}

type FocusError = { ok: false; status: 400 | 404; body: { error: string; code: string } };

// Parses `?skill=&tag=` from a query string. Empty strings mean "not set".
// An unknown tag is a 404 so a client holding a deleted tag can tell.
export async function parseFocus(q: Record<string, unknown>): Promise<{ ok: true; focus: FocusT } | FocusError> {
  const raw = {
    skill: typeof q.skill === "string" && q.skill !== "" ? q.skill : undefined,
    tag: typeof q.tag === "string" && q.tag !== "" ? q.tag : undefined,
  };
  const parsed = Focus.safeParse(raw);
  if (!parsed.success) {
    const bad = parsed.error.errors[0]?.path[0];
    return bad === "skill"
      ? { ok: false, status: 400, body: { error: `unsupported skill: ${raw.skill}`, code: "SKILL_UNSUPPORTED" } }
      : { ok: false, status: 400, body: { error: `invalid tag: ${raw.tag}`, code: "BAD_TAG" } };
  }
  if (parsed.data.tag && !(await tagExists(parsed.data.tag))) {
    return { ok: false, status: 404, body: { error: "tag not found", code: "TAG_NOT_FOUND" } };
  }
  return { ok: true, focus: parsed.data };
}
