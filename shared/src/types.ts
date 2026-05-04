import { z } from "zod";

export { sanitizeRuby } from "./sanitize.js";

export const AuthCheckRequest = z.object({}).strict();
export type AuthCheckRequest = z.infer<typeof AuthCheckRequest>;

export const AuthCheckResponse = z.object({ ok: z.literal(true) });
export type AuthCheckResponse = z.infer<typeof AuthCheckResponse>;

// ----- Vocab item -----

export const VocabPrompt = z.object({
  sentence_ruby: z.string(),
  target: z.string(),
  sentence_english: z.string(),
});
export type VocabPrompt = z.infer<typeof VocabPrompt>;

export const VocabAnswer = z.object({
  meaning: z.string(),
  reading: z.string(),
  notes: z.string().optional(),
});
export type VocabAnswer = z.infer<typeof VocabAnswer>;

export const Skill = z.enum(["vocab", "grammar", "reading", "conjugation", "particle"]);
export type Skill = z.infer<typeof Skill>;

export const Source = z.enum(["seed", "ai", "user"]);
export type Source = z.infer<typeof Source>;

export const ItemRecord = z.object({
  id: z.string().uuid(),
  skill: Skill,
  prompt: VocabPrompt,           // Phase 1: vocab only
  answer: VocabAnswer,
  source: Source,
  tags: z.array(z.string()),
  created_at: z.string(),        // ISO
});
export type ItemRecord = z.infer<typeof ItemRecord>;

// ----- API: queue -----

export const QueueResponse = z.object({
  due: z.array(ItemRecord),
  new: z.array(ItemRecord),
});
export type QueueResponse = z.infer<typeof QueueResponse>;

// ----- API: sessions -----

export const StartSessionRequest = z.object({
  skill_filter: Skill.optional(),
});
export type StartSessionRequest = z.infer<typeof StartSessionRequest>;

export const StartSessionResponse = z.object({ id: z.string().uuid() });
export type StartSessionResponse = z.infer<typeof StartSessionResponse>;

export const EndSessionRequest = z.object({
  ended_at: z.string(),  // ISO
});
export type EndSessionRequest = z.infer<typeof EndSessionRequest>;

// ----- API: reviews -----

export const ReviewResult = z.enum(["got_it", "missed"]);
export type ReviewResult = z.infer<typeof ReviewResult>;

export const SubmitReviewRequest = z.object({
  item_id: z.string().uuid(),
  result: ReviewResult,
  reviewed_at: z.string(),       // ISO, client-supplied
  session_id: z.string().uuid().optional(),
});
export type SubmitReviewRequest = z.infer<typeof SubmitReviewRequest>;

export const ReviewStateResponse = z.object({
  box: z.number().int().min(1).max(5),
  next_review_at: z.string(),    // ISO
  total_reviews: z.number().int().nonnegative(),
  total_missed: z.number().int().nonnegative(),
});
export type ReviewStateResponse = z.infer<typeof ReviewStateResponse>;

// ----- API: stats/streak -----

export const StreakResponse = z.object({
  days: z.number().int().nonnegative(),
});
export type StreakResponse = z.infer<typeof StreakResponse>;
