import { describe, it, expect } from "vitest";
import { sanitizeRuby } from "./sanitize.js";

describe("sanitizeRuby", () => {
  it("preserves valid ruby markup", () => {
    const input = "<ruby>漢字<rt>かんじ</rt></ruby>";
    expect(sanitizeRuby(input)).toBe("<ruby>漢字<rt>かんじ</rt></ruby>");
  });

  it("preserves rp tags", () => {
    const input = "<ruby>日<rp>(</rp><rt>ひ</rt><rp>)</rp></ruby>";
    expect(sanitizeRuby(input)).toBe("<ruby>日<rp>(</rp><rt>ひ</rt><rp>)</rp></ruby>");
  });

  it("strips disallowed tags", () => {
    const input = "<script>alert(1)</script><ruby>日<rt>ひ</rt></ruby>";
    expect(sanitizeRuby(input)).toBe("<ruby>日<rt>ひ</rt></ruby>");
  });

  it("strips attributes from allowed tags", () => {
    const input = `<ruby onclick="x">日<rt class="x">ひ</rt></ruby>`;
    expect(sanitizeRuby(input)).toBe("<ruby>日<rt>ひ</rt></ruby>");
  });

  it("preserves plain text outside tags", () => {
    const input = "今日は<ruby>晴<rt>は</rt></ruby>れです";
    expect(sanitizeRuby(input)).toBe("今日は<ruby>晴<rt>は</rt></ruby>れです");
  });
});
