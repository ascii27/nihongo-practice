import { describe, it, expect } from "vitest";
import { Skill, ListeningPrompt, ListeningAnswer, DashboardResponse } from "./types.js";

describe("listening types", () => {
  it("accepts listening as a Skill", () => {
    expect(Skill.parse("listening")).toBe("listening");
  });

  it("parses a valid ListeningPrompt", () => {
    const p = {
      audio_url: "/audio/abc.mp3",
      audio_kind: "dialogue",
      topic: "at the station",
      jlpt_level: "N4",
      questions: [
        { question_english: "Where are they?", options: ["a", "b", "c", "d"], answer_index: 1 },
      ],
    };
    expect(ListeningPrompt.parse(p)).toEqual(p);
  });

  it("rejects a question without exactly 4 options", () => {
    const bad = {
      audio_url: "/audio/abc.mp3", audio_kind: "monologue", topic: "t", jlpt_level: "N5",
      questions: [{ question_english: "q", options: ["a", "b"], answer_index: 0 }],
    };
    expect(ListeningPrompt.safeParse(bad).success).toBe(false);
  });

  it("parses a ListeningAnswer", () => {
    const a = { transcript_ruby: "<ruby>駅<rt>えき</rt></ruby>です", translation_english: "It's a station." };
    expect(ListeningAnswer.parse(a)).toEqual(a);
  });

  it("DashboardResponse.by_skill requires a listening bucket", () => {
    const base = { due: 0, new: 0 };
    const without = {
      streak_days: 0, last_practiced_at: null,
      by_skill: { vocab: base, grammar: base, reading: base, conjugation: base, particle: base, explain: base },
    };
    expect(DashboardResponse.safeParse(without).success).toBe(false);
  });
});
