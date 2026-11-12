import { describe, it, expect } from "vitest";
import { focusClause, hasFocus } from "./focus.js";

const TAG = "11111111-1111-1111-1111-111111111111";

describe("focusClause", () => {
  it("is empty for no focus", () => {
    expect(focusClause({}, 1)).toEqual({ sql: "", params: [] });
  });
  it("filters skill and tag with consecutive params", () => {
    const c = focusClause({ skill: "kanji", tag: TAG }, 3);
    expect(c.params).toEqual(["kanji", TAG]);
    expect(c.sql).toContain("i.skill = $3");
    expect(c.sql).toContain("ft.tag_id = $4");
  });
  it("numbers a tag-only focus from the first param", () => {
    const c = focusClause({ tag: TAG }, 2);
    expect(c.params).toEqual([TAG]);
    expect(c.sql).toContain("ft.tag_id = $2");
  });
  it("honours a custom alias", () => {
    expect(focusClause({ skill: "vocab" }, 1, "x").sql).toContain("x.skill = $1");
  });
});

describe("hasFocus", () => {
  it("is false for {} and true for either part", () => {
    expect(hasFocus({})).toBe(false);
    expect(hasFocus({ skill: "grammar" })).toBe(true);
    expect(hasFocus({ tag: TAG })).toBe(true);
  });
});
