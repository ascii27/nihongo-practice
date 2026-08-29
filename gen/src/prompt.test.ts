import { describe, it, expect } from "vitest";
import { buildVocabPrompt, buildSentencesForCardsPrompt, buildGrammarPrompt, buildParticlePrompt, buildConjugationPrompt, buildReadingPrompt, buildKanjiMnemonicPrompt } from "./prompt.js";

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

describe("buildGrammarPrompt", () => {
  it("asks for the requested count and returns strict JSON instructions", () => {
    const { system, user } = buildGrammarPrompt({ count: 4 });
    expect(system).toMatch(/JSON/i);
    expect(system).toContain('"items"');
    expect(system).toContain('"pattern"');
    expect(system).toContain('"sentence_japanese"');
    expect(system).toContain('"sentence_english"');
    expect(system).toContain('"explanation"');
    expect(user).toContain("4");
  });

  it("includes the weakness hint when provided", () => {
    const { user } = buildGrammarPrompt({ count: 2, weakness_hint: "te-form connectives" });
    expect(user).toContain("te-form connectives");
  });
});

describe("buildParticlePrompt", () => {
  it("asks for the requested count and the four-option shape", () => {
    const { system, user } = buildParticlePrompt({ count: 3 });
    expect(system).toMatch(/JSON/i);
    expect(system).toContain('"options"');
    expect(system).toContain('"answer_index"');
    expect(system).toContain('"explanation"');
    expect(user).toContain("3");
  });

  it("includes the weakness hint when provided", () => {
    const { user } = buildParticlePrompt({ count: 2, weakness_hint: "は vs が" });
    expect(user).toContain("は vs が");
  });
});

describe("buildConjugationPrompt", () => {
  it("requests the count and the conjugation JSON shape", () => {
    const { system, user } = buildConjugationPrompt({ count: 5 });
    expect(system).toContain('"base"');
    expect(system).toContain('"tense"');
    expect(system).toContain('"expected"');
    expect(user).toContain("5");
  });
  it("includes weakness hint", () => {
    const { user } = buildConjugationPrompt({ count: 2, weakness_hint: "te-form" });
    expect(user).toContain("te-form");
  });
});

describe("buildReadingPrompt", () => {
  it("asks for count and the reading JSON shape", () => {
    const { system, user } = buildReadingPrompt({ count: 2 });
    expect(system).toContain('"passage_japanese"');
    expect(system).toContain('"question_english"');
    expect(system).toContain('"answer_english"');
    expect(user).toContain("2");
  });
  it("includes weakness hint", () => {
    const { user } = buildReadingPrompt({ count: 1, weakness_hint: "daily life topics" });
    expect(user).toContain("daily life topics");
  });
});

describe("buildKanjiMnemonicPrompt", () => {
  const args = {
    character: "整",
    meanings: ["organize", "arrange"],
    on: ["セイ"],
    kun: ["ととの.える", "ととの.う"],
  };

  it("asks for strict JSON with the mnemonic shape", () => {
    const { system } = buildKanjiMnemonicPrompt(args);
    expect(system).toMatch(/JSON/i);
    expect(system).toContain('"meaning"');
    expect(system).toContain('"readings"');
    expect(system).toContain('"sound_hook"');
    expect(system).toContain('"sentence_japanese"');
  });

  it("forbids presenting the component breakdown as etymology", () => {
    const { system } = buildKanjiMnemonicPrompt(args);
    expect(system.toLowerCase()).toContain("etymolog");
  });

  it("caps the reading count at four", () => {
    const { system } = buildKanjiMnemonicPrompt(args);
    expect(system).toContain("4");
  });

  it("puts the character and its meanings and readings in the user message", () => {
    const { user } = buildKanjiMnemonicPrompt(args);
    expect(user).toContain("整");
    expect(user).toContain("organize, arrange");
    expect(user).toContain("セイ");
    expect(user).toContain("ととの.える");
    expect(user).toContain("ととの.う");
  });

  it("says none when a reading list is empty", () => {
    const { user } = buildKanjiMnemonicPrompt({ ...args, kun: [] });
    expect(user).toMatch(/kun'yomi[^\n]*none/i);
  });
});
