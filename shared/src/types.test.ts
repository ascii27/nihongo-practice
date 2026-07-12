import { describe, it, expect } from "vitest";
import { Skill, ListeningPrompt, ListeningAnswer, DashboardResponse, CreateLessonRequest, LessonDetail, TodayLessonResponse, LessonBlock } from "./types.js";

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
  it("accepts a valid auto CreateLessonRequest", () => {
    const r = { mode: "auto", theme: "giving advice", jlpt_level: "N4" };
    expect(CreateLessonRequest.parse(r)).toEqual(r);
  });
  it("accepts a valid manual CreateLessonRequest", () => {
    const r = { mode: "manual", grammar_point_ids: ["11111111-1111-1111-1111-111111111111"], jlpt_level: "N4" };
    expect(CreateLessonRequest.parse(r)).toEqual(r);
  });
  it("rejects a manual request with no grammar points", () => {
    expect(CreateLessonRequest.safeParse({ mode: "manual", grammar_point_ids: [], jlpt_level: "N5" }).success).toBe(false);
  });
  it("rejects a manual request with more than 3 grammar points", () => {
    const ids = Array.from({ length: 4 }, (_, i) => `1111111${i}-1111-1111-1111-111111111111`);
    expect(CreateLessonRequest.safeParse({ mode: "manual", grammar_point_ids: ids, jlpt_level: "N5" }).success).toBe(false);
  });
  it("rejects an invalid jlpt level", () => {
    expect(CreateLessonRequest.safeParse({ mode: "auto", theme: "x", jlpt_level: "N9" }).success).toBe(false);
  });
  it("parses TodayLessonResponse with a null lesson", () => {
    expect(TodayLessonResponse.parse({ lesson: null, generating: true })).toEqual({ lesson: null, generating: true });
  });
  it("parses a LessonDetail with ordered blocks", () => {
    const d = { id: "11111111-1111-1111-1111-111111111111", title: "t", topic: "x", jlpt_level: "N4", mode: "auto", status: "ready", progress: "not_started", current_section: null, blocks: [] };
    expect(LessonDetail.parse(d)).toEqual(d);
  });
});

describe("LessonBlock", () => {
  it("parses a grammar block with a dialogue + explanation", () => {
    const b = LessonBlock.parse({
      type: "grammar",
      point: { id: "11111111-1111-1111-1111-111111111111", title: "〜てもいい", romaji: "te mo ii", meaning: "may; is allowed to" },
      dialog: [{ speaker: "A", jp_ruby: "<ruby>行<rt>い</rt></ruby>ってもいいですか", en: "May I go?" }],
      explanation: "〜てもいい asks or grants permission. Attach it to the て-form...",
    });
    expect(b.type).toBe("grammar");
  });
  it("parses a reading block carrying a single item", () => {
    const item = { id: "22222222-2222-2222-2222-222222222222", skill: "reading", prompt: {}, answer: {}, source: "ai", tags: [], created_at: "2026-07-11T00:00:00.000Z" };
    const b = LessonBlock.parse({ type: "reading", item });
    expect(b.type).toBe("reading");
  });
});
