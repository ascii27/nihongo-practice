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

export const Skill = z.enum(["vocab", "grammar", "reading", "conjugation", "particle", "explain", "listening", "kanji"]);
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
  answer_given: z.string().max(200).optional(),
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
  skill: Skill,                                       // any Skill enum value
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
  daily_review_target: z.number().int(),
});
export type SettingsStatusResponse = z.infer<typeof SettingsStatusResponse>;

// The daily review goal. Multiples of 10 only — the Settings stepper moves in
// tens, and allowing arbitrary values would let a hand-crafted request produce
// a number the UI can never step back to.
export const UpdateSettingsRequest = z.object({
  daily_review_target: z.number().int().min(10).max(100).multipleOf(10),
});
export type UpdateSettingsRequest = z.infer<typeof UpdateSettingsRequest>;

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

// conjugation — produce a specific conjugated form

export const ConjugationPrompt = z.object({
  base: z.string(),
  base_ruby: z.string(),
  tense: z.string(),
});
export type ConjugationPrompt = z.infer<typeof ConjugationPrompt>;

export const ConjugationAnswer = z.object({
  expected: z.string(),
  expected_ruby: z.string(),
  alternates: z.array(z.string()).optional(),
});
export type ConjugationAnswer = z.infer<typeof ConjugationAnswer>;

// reading — comprehend a short passage

export const ReadingPrompt = z.object({
  passage_ruby: z.string(),
  question_english: z.string(),
});
export type ReadingPrompt = z.infer<typeof ReadingPrompt>;

export const ReadingAnswer = z.object({
  answer_english: z.string(),
  answer_japanese_ruby: z.string().optional(),
});
export type ReadingAnswer = z.infer<typeof ReadingAnswer>;

// explain — free-text productive explanation, LLM-graded on a rubric

export const ExplainPrompt = z.object({
  task_english: z.string(),
  task_japanese_ruby: z.string().optional(),
  required_connectives: z.array(z.string()),   // e.g. ["つまり","その結果","一方で"]
  register: z.enum(["casual", "polite", "formal"]),
});
export type ExplainPrompt = z.infer<typeof ExplainPrompt>;

export const ExplainAnswer = z.object({
  model_explanation_ruby: z.string(),          // reference answer, furigana HTML
  rubric_notes: z.string(),                    // what a strong answer should contain
});
export type ExplainAnswer = z.infer<typeof ExplainAnswer>;

export const ExplainGrade = z.object({
  connective_use: z.number().min(0).max(1),
  structure: z.number().min(0).max(1),
  register: z.number().min(0).max(1),
  grammar: z.number().min(0).max(1),
  overall: z.number().min(0).max(1),
  corrected_ruby: z.string(),                  // furigana HTML
  feedback: z.string(),                        // 1–2 sentences
});
export type ExplainGrade = z.infer<typeof ExplainGrade>;

// POST /api/explain/grade — pure scoring, no DB write. Client records the
// review afterward via POST /api/reviews (idempotency model untouched).
export const ExplainGradeRequest = z.object({
  item_id: z.string().uuid(),
  answer_given: z.string().min(1).max(2000),
});
export type ExplainGradeRequest = z.infer<typeof ExplainGradeRequest>;

export const ExplainGradeResponse = z.object({
  grade: ExplainGrade,
  result: ReviewResult,                        // overall >= 0.6 → got_it
  cost_usd: z.number().nonnegative(),
});
export type ExplainGradeResponse = z.infer<typeof ExplainGradeResponse>;

// ----- Kanji item -----
//
// Kanji cards are seeded from KanjiVG (ordered stroke paths) + KANJIDIC2
// (meanings/readings). The item carries only the light display fields; the
// heavy stroke-path data lives in the `kanji` reference table and is fetched
// on demand (KanjiDetail) by the drawing card.

export const KanjiPrompt = z.object({
  character: z.string(),
});
export type KanjiPrompt = z.infer<typeof KanjiPrompt>;

export const KanjiAnswer = z.object({
  meanings: z.array(z.string()),
  on: z.array(z.string()),        // on'yomi readings
  kun: z.array(z.string()),       // kun'yomi readings
  stroke_count: z.number().int().nonnegative(),
});
export type KanjiAnswer = z.infer<typeof KanjiAnswer>;

// GET /api/kanji — browse/search row (no stroke paths)
export const KanjiBrowseItem = z.object({
  character: z.string(),
  meanings: z.array(z.string()),
  stroke_count: z.number().int().nonnegative(),
  jlpt: z.string().nullable(),
});
export type KanjiBrowseItem = z.infer<typeof KanjiBrowseItem>;

export const KanjiBrowseResponse = z.object({ kanji: z.array(KanjiBrowseItem) });
export type KanjiBrowseResponse = z.infer<typeof KanjiBrowseResponse>;

// GET /api/kanji/:character — full detail including ordered stroke paths, used
// by the drawing card for the stroke-order animation.
export const KanjiDetail = z.object({
  character: z.string(),
  strokes: z.array(z.string()),   // ordered SVG path 'd' strings, KanjiVG order
  stroke_count: z.number().int().nonnegative(),
  radical: z.string().nullable(),
  meanings: z.array(z.string()),
  on: z.array(z.string()),
  kun: z.array(z.string()),
  jlpt: z.string().nullable(),
});
export type KanjiDetail = z.infer<typeof KanjiDetail>;

// ----- Listening item -----

export const ListeningQuestion = z.object({
  question_english: z.string(),
  options: z.array(z.string()).length(4),
  answer_index: z.number().int().min(0).max(3),
});
export type ListeningQuestion = z.infer<typeof ListeningQuestion>;

export const ListeningPrompt = z.object({
  audio_url: z.string(),                       // e.g. "/audio/<uuid>.mp3"
  audio_kind: z.enum(["monologue", "dialogue"]),
  topic: z.string(),
  jlpt_level: z.string(),                       // "N5".."N1"
  questions: z.array(ListeningQuestion).min(1).max(4),
});
export type ListeningPrompt = z.infer<typeof ListeningPrompt>;

export const ListeningAnswer = z.object({
  transcript_ruby: z.string(),                  // furigana HTML, revealed after answering
  translation_english: z.string(),
  question_explanations: z.array(z.string()).optional(),
});
export type ListeningAnswer = z.infer<typeof ListeningAnswer>;

// ----- API: dashboard -----

export const SkillCounts = z.object({
  due: z.number().int().nonnegative(),
  new: z.number().int().nonnegative(),
});
export type SkillCounts = z.infer<typeof SkillCounts>;

export const DashboardResponse = z.object({
  streak_days: z.number().int().nonnegative(),
  last_practiced_at: z.string().nullable(),
  // Daily budget. `daily_target` and `reviewed_today` drive the congratulation
  // copy; `remaining` is how much allowance is left, which is not the same as
  // how much practice is available.
  daily_target: z.number().int().positive(),
  reviewed_today: z.number().int().nonnegative(),
  remaining: z.number().int().nonnegative(),
  // Exactly how many cards the next mixed-practice session will deal — the
  // budget and the new-card share and the real pools, all resolved server-side.
  // This is the hero's number; the client must render it, not re-derive one.
  session_size: z.number().int().nonnegative(),
  // What that session would deal after unlocking one more round. 0 means
  // offering another round would be a dead end, so the button stays hidden.
  another_round_size: z.number().int().nonnegative(),
  by_skill: z.object({
    vocab: SkillCounts,
    grammar: SkillCounts,
    reading: SkillCounts,
    conjugation: SkillCounts,
    particle: SkillCounts,
    explain: SkillCounts,
    listening: SkillCounts,
    kanji: SkillCounts,
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
    explain: SkillStats,
    listening: SkillStats,
    kanji: SkillStats,
  }),
});
export type StatsBySkillResponse = z.infer<typeof StatsBySkillResponse>;

// ----- API: library (Browse) -----

// A single browsable card, with display fields derived server-side from the
// skill-specific prompt/answer JSON, plus a Leitner-box-derived mastery (0..1).
export const LibraryItem = z.object({
  id: z.string().uuid(),
  skill: Skill,
  front: z.string(),
  reading: z.string().nullable(),
  meaning: z.string(),
  mastery: z.number().min(0).max(1),
});
export type LibraryItem = z.infer<typeof LibraryItem>;

export const LibrarySkillGroup = z.object({
  count: z.number().int().nonnegative(),       // total items in the skill
  avg_mastery: z.number().min(0).max(1),       // mean mastery over all items
  items: z.array(LibraryItem),                 // capped sample (newest first)
});
export type LibrarySkillGroup = z.infer<typeof LibrarySkillGroup>;

export const LibraryResponse = z.object({
  by_skill: z.object({
    vocab: LibrarySkillGroup,
    grammar: LibrarySkillGroup,
    reading: LibrarySkillGroup,
    conjugation: LibrarySkillGroup,
    particle: LibrarySkillGroup,
    explain: LibrarySkillGroup,
    listening: LibrarySkillGroup,
    kanji: LibrarySkillGroup,
  }),
});
export type LibraryResponse = z.infer<typeof LibraryResponse>;

// ----- API: items/manual (user-added vocab) -----
//
// Two-step flow:
//   POST /api/items/manual/translate  → preview only (no DB write)
//   POST /api/items/manual            → commits the (possibly edited) preview
// Lets the learner sanity-check the AI's output before it joins their queue.

export const ManualVocabPreviewRequest = z.object({
  input: z.string().min(1).max(120),
});
export type ManualVocabPreviewRequest = z.infer<typeof ManualVocabPreviewRequest>;

export const ManualVocabFields = z.object({
  japanese: z.string().min(1).max(120),
  english: z.string().min(1).max(120),
  sentence_japanese: z.string().min(1).max(200),
  sentence_english: z.string().min(1).max(200),
});
export type ManualVocabFields = z.infer<typeof ManualVocabFields>;

export const ManualVocabPreviewResponse = ManualVocabFields.extend({
  cost_usd: z.number().nonnegative(),
});
export type ManualVocabPreviewResponse = z.infer<typeof ManualVocabPreviewResponse>;

export const ManualVocabSaveRequest = ManualVocabFields;
export type ManualVocabSaveRequest = z.infer<typeof ManualVocabSaveRequest>;

export const ManualVocabSaveResponse = z.object({
  item: ItemRecord,
});
export type ManualVocabSaveResponse = z.infer<typeof ManualVocabSaveResponse>;

// ----- API: stats/overview -----

export const HardestCard = z.object({
  id: z.string().uuid(),
  skill: Skill,
  front: z.string(),
  meaning: z.string(),
  accuracy: z.number().min(0).max(1),
});
export type HardestCard = z.infer<typeof HardestCard>;

export const StatsOverviewResponse = z.object({
  streak_days: z.number().int().nonnegative(),
  longest_streak: z.number().int().nonnegative(),
  total_reviewed: z.number().int().nonnegative(),
  overall_accuracy: z.number().min(0).max(1).nullable(),  // null if no reviews
  daily_reviews: z.array(z.number().int().nonnegative()).length(30),  // oldest → today
  hardest_cards: z.array(HardestCard),                    // up to 5, lowest accuracy
});
export type StatsOverviewResponse = z.infer<typeof StatsOverviewResponse>;

// ----- Lessons (Phase 2) -----

export const LessonStatus = z.enum(["generating", "ready", "failed"]);
export type LessonStatus = z.infer<typeof LessonStatus>;

export const LessonProgress = z.enum(["not_started", "in_progress", "completed"]);
export type LessonProgress = z.infer<typeof LessonProgress>;

export const LessonKind = z.enum(["lesson", "assessment"]);
export type LessonKind = z.infer<typeof LessonKind>;

export const JlptLevel = z.enum(["N5", "N4", "N3", "N2", "N1"]);
export type JlptLevel = z.infer<typeof JlptLevel>;

// A grammar point from the JLPT catalog. Lessons are built around 1–3 of these.
export const GrammarPoint = z.object({
  id: z.string().uuid(),
  jlpt_level: JlptLevel,
  sort_order: z.number().int(),
  title: z.string(),          // the grammar point in Japanese
  romaji: z.string().nullable(),
  meaning: z.string(),        // short English gloss
  slug: z.string(),
});
export type GrammarPoint = z.infer<typeof GrammarPoint>;

export const GrammarPointsResponse = z.object({ grammar_points: z.array(GrammarPoint) });
export type GrammarPointsResponse = z.infer<typeof GrammarPointsResponse>;

// Two ways to create a lesson. Auto: give a theme + level, the AI picks 1–3
// related grammar points from the catalog. Manual: pick the grammar points
// yourself. Both build a lesson around 1–3 grammar points.
export const CreateLessonRequestAuto = z.object({
  mode: z.literal("auto"),
  theme: z.string().min(1).max(120),
  jlpt_level: JlptLevel,
});
export const CreateLessonRequestManual = z.object({
  mode: z.literal("manual"),
  grammar_point_ids: z.array(z.string().uuid()).min(1).max(3),
  jlpt_level: JlptLevel,
});
export const CreateLessonRequest = z.discriminatedUnion("mode", [
  CreateLessonRequestAuto,
  CreateLessonRequestManual,
]);
export type CreateLessonRequest = z.infer<typeof CreateLessonRequest>;

export const CreateLessonResponse = z.object({
  id: z.string().uuid(),
  status: LessonStatus,
});
export type CreateLessonResponse = z.infer<typeof CreateLessonResponse>;

export const LessonSummary = z.object({
  id: z.string().uuid(),
  title: z.string(),
  topic: z.string(),
  jlpt_level: z.string(),
  kind: LessonKind,
  status: LessonStatus,
  progress: LessonProgress,
  item_count: z.number().int().nonnegative(),
  created_at: z.string(),
});
export type LessonSummary = z.infer<typeof LessonSummary>;

export const LessonsListResponse = z.object({ lessons: z.array(LessonSummary) });
export type LessonsListResponse = z.infer<typeof LessonsListResponse>;

// A line of the example dialogue shown in grammar teaching.
export const DialogLine = z.object({
  speaker: z.string(),
  jp_ruby: z.string(),
  en: z.string(),
});
export type DialogLine = z.infer<typeof DialogLine>;

// A lesson is an ordered list of blocks, walked top to bottom:
//   grammar (teach) → vocab (teach + review) → reading / listening (lesson-only)
//   → quiz / cloze (review). Grammar/vocab/quiz/cloze feed the SRS via real
//   `items`; reading/listening are lesson-only synthetic records.
export const GrammarBlock = z.object({
  type: z.literal("grammar"),
  point: z.object({
    id: z.string().uuid(),
    title: z.string(),
    romaji: z.string().nullable(),
    meaning: z.string(),
  }),
  dialog: z.array(DialogLine),           // short example dialogue in context
  explanation: z.string(),               // English explanation of the point + nuances
});
export const VocabBlock = z.object({ type: z.literal("vocab"), items: z.array(ItemRecord) });
export const ReadingBlock = z.object({ type: z.literal("reading"), item: ItemRecord });
export const ListeningBlock = z.object({ type: z.literal("listening"), item: ItemRecord });

// The final quiz — a mix of question formats testing the lesson's grammar +
// vocab. Lesson-only (scored once, not added to the SRS review queue). Each
// question has a stem plus an optional Japanese sentence/context.
export const QuizQuestion = z.object({
  question: z.string(),                   // the question stem, in English
  sentence_ruby: z.string().optional(),   // optional JP context/sentence (furigana HTML), may contain ___
  options: z.array(z.string()),
  answer_index: z.number().int(),
  explanation: z.string(),
});
export type QuizQuestion = z.infer<typeof QuizQuestion>;

export const QuizBlock = z.object({ type: z.literal("quiz"), questions: z.array(QuizQuestion) });

export const LessonBlock = z.discriminatedUnion("type", [
  GrammarBlock, VocabBlock, ReadingBlock, ListeningBlock, QuizBlock,
]);
export type LessonBlock = z.infer<typeof LessonBlock>;
export type LessonBlockType = LessonBlock["type"];

export const LessonDetail = z.object({
  id: z.string().uuid(),
  title: z.string(),
  topic: z.string(),                        // the theme (auto) or synthesized title (manual)
  jlpt_level: z.string(),
  mode: z.enum(["auto", "manual"]),
  status: LessonStatus,
  progress: LessonProgress,
  current_section: z.string().nullable(),   // resume point: id of the in-progress block
  blocks: z.array(LessonBlock),
});
export type LessonDetail = z.infer<typeof LessonDetail>;

export const LessonStatusResponse = z.object({
  status: LessonStatus,
  error: z.string().nullable(),
});
export type LessonStatusResponse = z.infer<typeof LessonStatusResponse>;

export const TodayLessonResponse = z.object({
  lesson: LessonSummary.nullable(),
  generating: z.boolean(),
});
export type TodayLessonResponse = z.infer<typeof TodayLessonResponse>;

export const LessonStateUpdate = z.object({
  progress: LessonProgress,
  current_section: z.string().nullable(),
  current_index: z.number().int().nonnegative(),
});
export type LessonStateUpdate = z.infer<typeof LessonStateUpdate>;

// ----- Study lists -----
//
// A user-built collection mixing any skills (vocab / grammar / kanji / …),
// mainly for class study. Members are ordinary `items`, so they flow through
// the normal SRS when due; a list can also be "crammed" (all cards, ignoring
// the schedule). Mirrors the lessons header + join-table shape.

export const StudyListSummary = z.object({
  id: z.string().uuid(),
  title: z.string(),
  description: z.string(),
  item_count: z.number().int().nonnegative(),
  created_at: z.string(),
});
export type StudyListSummary = z.infer<typeof StudyListSummary>;

export const StudyListsResponse = z.object({ study_lists: z.array(StudyListSummary) });
export type StudyListsResponse = z.infer<typeof StudyListsResponse>;

export const StudyListDetail = StudyListSummary.extend({
  items: z.array(LibraryItem),   // display rows, same shape as Browse
});
export type StudyListDetail = z.infer<typeof StudyListDetail>;

export const CreateStudyListRequest = z.object({
  title: z.string().min(1).max(120),
  description: z.string().max(400).optional(),
});
export type CreateStudyListRequest = z.infer<typeof CreateStudyListRequest>;

export const CreateStudyListResponse = z.object({ id: z.string().uuid() });
export type CreateStudyListResponse = z.infer<typeof CreateStudyListResponse>;

export const AddStudyItemRequest = z.object({ item_id: z.string().uuid() });
export type AddStudyItemRequest = z.infer<typeof AddStudyItemRequest>;

// Quick-add is a two-step flow (like manual vocab): the learner types a word /
// kanji / grammar pattern, the server generates an editable translation +
// example, the learner tweaks it, then saves. Vocab & grammar use the AI;
// kanji fills meaning/readings from the seeded reference table.

export const StudyVocabFields = z.object({
  japanese: z.string().min(1).max(120),
  english: z.string().min(1).max(120),
  sentence_japanese: z.string().min(1).max(200),
  sentence_english: z.string().min(1).max(200),
});
export type StudyVocabFields = z.infer<typeof StudyVocabFields>;

export const StudyGrammarFields = z.object({
  pattern: z.string().min(1).max(120),
  explanation: z.string().min(1).max(400),
  sentence_japanese: z.string().max(200),
  sentence_english: z.string().max(200),
});
export type StudyGrammarFields = z.infer<typeof StudyGrammarFields>;

// Preview only (no DB write): generate editable fields from a raw input.
export const StudyPreviewRequest = z.object({
  kind: z.enum(["vocab", "kanji", "grammar"]),
  input: z.string().min(1).max(200),
});
export type StudyPreviewRequest = z.infer<typeof StudyPreviewRequest>;

export const StudyPreviewResponse = z.discriminatedUnion("kind", [
  StudyVocabFields.extend({ kind: z.literal("vocab"), cost_usd: z.number().nonnegative() }),
  StudyGrammarFields.extend({ kind: z.literal("grammar"), cost_usd: z.number().nonnegative() }),
  z.object({
    kind: z.literal("kanji"),
    character: z.string(),
    meaning: z.string(),        // editable, comma-joined meanings
    readings: z.string(),       // display-only, on/kun joined
    cost_usd: z.number().nonnegative(),
  }),
]);
export type StudyPreviewResponse = z.infer<typeof StudyPreviewResponse>;

// Save the (edited) preview into the list.
export const QuickAddStudyItemRequest = z.discriminatedUnion("kind", [
  StudyVocabFields.extend({ kind: z.literal("vocab") }),
  StudyGrammarFields.extend({ kind: z.literal("grammar") }),
  z.object({
    kind: z.literal("kanji"),
    character: z.string().min(1).max(4),
    meaning: z.string().max(200),
  }),
]);
export type QuickAddStudyItemRequest = z.infer<typeof QuickAddStudyItemRequest>;

export const QuickAddStudyItemResponse = z.object({ item_id: z.string().uuid() });
export type QuickAddStudyItemResponse = z.infer<typeof QuickAddStudyItemResponse>;

export const StudyCandidatesResponse = z.object({ items: z.array(LibraryItem) });
export type StudyCandidatesResponse = z.infer<typeof StudyCandidatesResponse>;

// Cram: every card in the list as review items, schedule ignored.
export const StudyCramResponse = z.object({ items: z.array(ItemRecord) });
export type StudyCramResponse = z.infer<typeof StudyCramResponse>;
