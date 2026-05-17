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
  prompt: z.unknown(),
  answer: z.unknown(),
  source: Source,
  external_id: z.string().nullable().optional(),
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
  ended_at: z.string().datetime(),  // ISO
});
export type EndSessionRequest = z.infer<typeof EndSessionRequest>;

// ----- API: reviews -----

export const ReviewResult = z.enum(["got_it", "missed"]);
export type ReviewResult = z.infer<typeof ReviewResult>;

export const SubmitReviewRequest = z.object({
  item_id: z.string().uuid(),
  result: ReviewResult,
  reviewed_at: z.string().datetime(),       // ISO, client-supplied
  session_id: z.string().uuid().optional(),
});
export type SubmitReviewRequest = z.infer<typeof SubmitReviewRequest>;

export const ReviewStateResponse = z.object({
  box: z.number().int().min(1).max(5),
  next_review_at: z.string().datetime(),    // ISO
  total_reviews: z.number().int().nonnegative(),
  total_missed: z.number().int().nonnegative(),
});
export type ReviewStateResponse = z.infer<typeof ReviewStateResponse>;

// ----- API: stats/streak -----

export const StreakResponse = z.object({
  days: z.number().int().nonnegative(),
});
export type StreakResponse = z.infer<typeof StreakResponse>;

// ----- API: generate -----

export const GenerateRequest = z.object({
  skill: Skill,                                       // all 5 values
  count: z.number().int().min(1).max(50),
  weakness_hint: z.string().max(200).optional(),
});
export type GenerateRequest = z.infer<typeof GenerateRequest>;

export const GenerateSuccess = z.object({
  generation_id: z.string().uuid(),
  status: z.enum(["success", "partial"]),
  items_created: z.number().int().nonnegative(),
  cost_usd: z.number().nonnegative(),
  items: z.array(ItemRecord),
});
export type GenerateSuccess = z.infer<typeof GenerateSuccess>;

export const GenerateFailure = z.object({
  generation_id: z.string().uuid(),
  status: z.literal("failed"),
  items_created: z.literal(0),
  cost_usd: z.number().nonnegative(),
  error: z.string(),
});
export type GenerateFailure = z.infer<typeof GenerateFailure>;

// ----- API: generations list -----

export const GenerationSummary = z.object({
  id: z.string().uuid(),
  requested_at: z.string(),       // ISO
  skill: z.string(),
  count_requested: z.number().int().nonnegative(),
  count_inserted: z.number().int().nonnegative(),
  weakness_hint: z.string().nullable(),
  cost_usd: z.number().nonnegative(),
  status: z.enum(["success", "partial", "failed"]),
  error: z.string().nullable(),
});
export type GenerationSummary = z.infer<typeof GenerationSummary>;

export const GenerationsResponse = z.object({
  generations: z.array(GenerationSummary),
});
export type GenerationsResponse = z.infer<typeof GenerationsResponse>;

// ----- API: settings status -----

export const SettingsStatusResponse = z.object({
  ai_key_configured: z.boolean(),
});
export type SettingsStatusResponse = z.infer<typeof SettingsStatusResponse>;

// ----- Per-skill prompt/answer shapes (parent spec) -----

export const GrammarPrompt = z.object({
  sentence_ruby: z.string(),
  pattern: z.string(),
  sentence_english: z.string(),
});
export type GrammarPrompt = z.infer<typeof GrammarPrompt>;

export const GrammarAnswer = z.object({
  explanation: z.string(),
  another_example_ruby: z.string().optional(),
});
export type GrammarAnswer = z.infer<typeof GrammarAnswer>;

// particle — pick the right particle (multiple choice)

export const ParticlePrompt = z.object({
  sentence_ruby_blanked: z.string(),
  options: z.array(z.string()).length(4),
  answer_index: z.number().int().min(0).max(3),
});
export type ParticlePrompt = z.infer<typeof ParticlePrompt>;

export const ParticleAnswer = z.object({
  explanation: z.string(),
});
export type ParticleAnswer = z.infer<typeof ParticleAnswer>;

// ----- API: dashboard -----

export const SkillCounts = z.object({
  due: z.number().int().nonnegative(),
  new: z.number().int().nonnegative(),
});
export type SkillCounts = z.infer<typeof SkillCounts>;

export const DashboardResponse = z.object({
  streak_days: z.number().int().nonnegative(),
  last_practiced_at: z.string().nullable(),
  by_skill: z.object({
    vocab: SkillCounts,
    grammar: SkillCounts,
    reading: SkillCounts,
    conjugation: SkillCounts,
    particle: SkillCounts,
  }),
});
export type DashboardResponse = z.infer<typeof DashboardResponse>;

// ----- API: stats/by-skill -----

export const SkillStats = z.object({
  box_counts: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative(), z.number().int().nonnegative(), z.number().int().nonnegative(), z.number().int().nonnegative()]),
  accuracy_30d: z.number().min(0).max(1).nullable(),  // null if no reviews
});
export type SkillStats = z.infer<typeof SkillStats>;

export const StatsBySkillResponse = z.object({
  by_skill: z.object({
    vocab: SkillStats,
    grammar: SkillStats,
    reading: SkillStats,
    conjugation: SkillStats,
    particle: SkillStats,
  }),
});
export type StatsBySkillResponse = z.infer<typeof StatsBySkillResponse>;
