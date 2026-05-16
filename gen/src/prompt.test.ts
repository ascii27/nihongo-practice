import { describe, it, expect } from "vitest";
import { buildVocabPrompt, buildSentencesForCardsPrompt } from "./prompt.js";

describe("buildVocabPrompt", () => {
  it("asks for the requested count and returns strict JSON instructions", () => {
    const { system, user } = buildVocabPrompt({ count: 7 });
    expect(system).toMatch(/JSON/i);
    expect(system).toContain('"items"');
    expect(system).toContain('"target"');
    expect(user).toContain("7");
  });

  it("includes the weakness hint verbatim when provided", () => {
    const { user } = buildVocabPrompt({ count: 5, weakness_hint: "verbs for cooking" });
    expect(user).toContain("verbs for cooking");
  });

  it("omits hint phrasing when no hint is provided", () => {
    const { user } = buildVocabPrompt({ count: 5 });
    expect(user.toLowerCase()).not.toContain("focus on");
  });
});

describe("buildSentencesForCardsPrompt", () => {
  it("includes each card's id and japanese term", () => {
    const { system, user } = buildSentencesForCardsPrompt([
      { external_id: "x1", japanese: "本", english: "book" },
      { external_id: "x2", japanese: "水", english: "water" },
    ]);
    expect(system).toContain('"sentences"');
    expect(user).toContain("id=x1");
    expect(user).toContain("本");
    expect(user).toContain("water");
  });
});
