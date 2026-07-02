import { describe, it, expect } from "vitest";
import { Skill, ListeningPrompt, ListeningAnswer, DashboardResponse, CreateLessonRequest, LessonDetail, TodayLessonResponse } from "./types.js";

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

describe("lesson types", () => {
  it("accepts a valid CreateLessonRequest", () => {
    const r = { topic: "keigo basics", jlpt_level: "N4", skills: ["vocab", "grammar", "listening"] };
    expect(CreateLessonRequest.parse(r)).toEqual(r);
  });
  it("rejects a CreateLessonRequest with no skills", () => {
    expect(CreateLessonRequest.safeParse({ topic: "x", jlpt_level: "N5", skills: [] }).success).toBe(false);
  });
  it("rejects an unknown skill", () => {
    expect(CreateLessonRequest.safeParse({ topic: "x", jlpt_level: "N5", skills: ["speaking"] }).success).toBe(false);
  });
  it("parses TodayLessonResponse with a null lesson", () => {
    expect(TodayLessonResponse.parse({ lesson: null, generating: true })).toEqual({ lesson: null, generating: true });
  });
  it("parses a LessonDetail with grouped sections", () => {
    const d = { id: "11111111-1111-1111-1111-111111111111", title: "t", topic: "x", jlpt_level: "N4", status: "ready", progress: "not_started", current_section: null, sections: [] };
    expect(LessonDetail.parse(d)).toEqual(d);
  });
});
