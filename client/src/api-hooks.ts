import { api } from "./api";
import type {
  QueueResponse,
  StartSessionResponse,
  ReviewStateResponse,
  StreakResponse,
  ReviewResult,
  GenerateRequest,
  GenerateSuccess,
  GenerationsResponse,
  SettingsStatusResponse,
  DashboardResponse,
  StatsBySkillResponse,
  LibraryResponse,
  StatsOverviewResponse,
  ManualVocabPreviewRequest,
  ManualVocabPreviewResponse,
  ManualVocabSaveRequest,
  ManualVocabSaveResponse,
  ExplainGradeRequest,
  ExplainGradeResponse,
  KanjiBrowseResponse,
  KanjiDetail,
  KanjiMnemonic,
  KanjiMnemonicLookupResponse,
  ItemDetailResponse,
  Skill,
  Focus,
  DrillQueueResponse,
  DrillReviewResponse,
  ReviewMode,
} from "@nihongo/shared";
import { focusQuery } from "./lib/focus";

function browserTz(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

// The day's budgeted session, narrowed by the focus ({} = everything).
export function fetchQueue(focus: Focus): Promise<QueueResponse> {
  const p = focusQuery(focus);
  p.set("tz", browserTz());
  return api<QueueResponse>(`/api/queue?${p.toString()}`);
}

// Every card in the focus, schedule ignored ("drill all anyway").
export function fetchDrill(focus: Focus): Promise<DrillQueueResponse> {
  const p = focusQuery(focus);
  p.set("mode", "drill");
  return api<DrillQueueResponse>(`/api/queue?${p.toString()}`);
}

export function fetchStreak(): Promise<StreakResponse> {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  return api<StreakResponse>(`/api/stats/streak?tz=${encodeURIComponent(tz)}`);
}

export function fetchDashboard(focus: Focus): Promise<DashboardResponse> {
  const p = focusQuery(focus);
  p.set("tz", browserTz());
  return api<DashboardResponse>(`/api/dashboard?${p.toString()}`);
}

// Unlocks one more full daily target. Returns the refreshed dashboard payload
// so the caller can swap state without a second fetch.
export function unlockAnotherRound(focus: Focus): Promise<DashboardResponse> {
  const p = focusQuery(focus);
  p.set("tz", browserTz());
  return api<DashboardResponse>(`/api/dashboard/round?${p.toString()}`, { method: "POST" });
}

export function fetchStatsBySkill(): Promise<StatsBySkillResponse> {
  return api<StatsBySkillResponse>(`/api/stats/by-skill`);
}

export function fetchLibrary(opts: { q?: string; skill?: Skill; tag?: string; offset?: number }): Promise<LibraryResponse> {
  const p = focusQuery({ skill: opts.skill, tag: opts.tag });
  if (opts.q) p.set("q", opts.q);
  if (opts.offset) p.set("offset", String(opts.offset));
  return api<LibraryResponse>(`/api/library?${p.toString()}`);
}

export function fetchStatsOverview(): Promise<StatsOverviewResponse> {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  return api<StatsOverviewResponse>(`/api/stats/overview?tz=${encodeURIComponent(tz)}`);
}

export function startSession(focus: Focus): Promise<StartSessionResponse> {
  return api<StartSessionResponse>("/api/sessions", {
    method: "POST",
    body: JSON.stringify({ skill_filter: focus.skill, tag_filter: focus.tag }),
  });
}

export function endSession(id: string): Promise<{ ok: true }> {
  return api(`/api/sessions/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ ended_at: new Date().toISOString() }),
  });
}

export function submitReview(input: {
  item_id: string;
  result: ReviewResult;
  reviewed_at: string;
  session_id?: string;
  answer_given?: string;
  mode?: ReviewMode;
}): Promise<ReviewStateResponse | DrillReviewResponse> {
  // Attach the caller's IANA timezone so the server can detect streak
  // milestones ("first review of today"). Harmless if the field is unused.
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return api<ReviewStateResponse | DrillReviewResponse>("/api/reviews", {
    method: "POST",
    body: JSON.stringify({ ...input, tz }),
  });
}

export function generateItems(input: GenerateRequest): Promise<GenerateSuccess> {
  return api<GenerateSuccess>("/api/generate", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function fetchGenerations(limit = 10): Promise<GenerationsResponse> {
  return api<GenerationsResponse>(`/api/generations?limit=${limit}`);
}

export function fetchSettingsStatus(): Promise<SettingsStatusResponse> {
  return api<SettingsStatusResponse>("/api/settings/status");
}

export function updateDailyTarget(daily_review_target: number): Promise<{ daily_review_target: number }> {
  return api<{ daily_review_target: number }>("/api/settings", {
    method: "PATCH",
    body: JSON.stringify({ daily_review_target }),
  });
}

// Manual vocab entry — two steps so the learner can review the AI's translation
// before it joins their deck.
export function previewManualVocab(input: ManualVocabPreviewRequest): Promise<ManualVocabPreviewResponse> {
  return api<ManualVocabPreviewResponse>("/api/items/manual/translate", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function saveManualVocab(input: ManualVocabSaveRequest): Promise<ManualVocabSaveResponse> {
  return api<ManualVocabSaveResponse>("/api/items/manual", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function gradeExplanation(input: ExplainGradeRequest): Promise<ExplainGradeResponse> {
  return api<ExplainGradeResponse>("/api/explain/grade", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

// One card in full — raw prompt/answer plus display fields and review state.
// Backs the card-detail sheet opened from a Library row.
export function fetchItem(id: string): Promise<ItemDetailResponse> {
  return api<ItemDetailResponse>(`/api/items/${encodeURIComponent(id)}`);
}

// ----- Kanji -----
export function searchKanji(q?: string, jlpt?: string): Promise<KanjiBrowseResponse> {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (jlpt) params.set("jlpt", jlpt);
  const qs = params.toString();
  return api<KanjiBrowseResponse>(`/api/kanji${qs ? `?${qs}` : ""}`);
}

export function fetchKanji(character: string): Promise<KanjiDetail> {
  return api<KanjiDetail>(`/api/kanji/${encodeURIComponent(character)}`);
}

export function fetchKanjiMnemonic(character: string): Promise<KanjiMnemonic> {
  return api<KanjiMnemonic>(`/api/kanji/${encodeURIComponent(character)}/mnemonic`);
}

// The mnemonic already written for this kanji, or null. Never generates — the
// card view offers that as an explicit choice instead.
export function fetchCachedKanjiMnemonic(character: string): Promise<KanjiMnemonicLookupResponse> {
  return api<KanjiMnemonicLookupResponse>(
    `/api/kanji/${encodeURIComponent(character)}/mnemonic/cached`,
  );
}

export function regenerateKanjiMnemonic(character: string): Promise<KanjiMnemonic> {
  return api<KanjiMnemonic>(
    `/api/kanji/${encodeURIComponent(character)}/mnemonic/regenerate`,
    { method: "POST" },
  );
}

// ----- Tags -----
import type {
  TagsResponse, CreateTagRequest, CreateTagResponse, UpdateTagRequest,
  QuickAddItemRequest, QuickAddItemResponse, TagCandidatesResponse,
  QuickAddPreviewRequest, QuickAddPreviewResponse,
} from "@nihongo/shared";

export function fetchTags(): Promise<TagsResponse> {
  return api<TagsResponse>("/api/tags");
}
export function createTag(body: CreateTagRequest): Promise<CreateTagResponse> {
  return api<CreateTagResponse>("/api/tags", { method: "POST", body: JSON.stringify(body) });
}
export function updateTag(id: string, body: UpdateTagRequest): Promise<void> {
  return api<void>(`/api/tags/${id}`, { method: "PATCH", body: JSON.stringify(body) });
}
export function deleteTag(id: string): Promise<void> {
  return api<void>(`/api/tags/${id}`, { method: "DELETE" });
}
export function tagItem(tagId: string, itemId: string): Promise<void> {
  return api<void>(`/api/tags/${tagId}/items/${itemId}`, { method: "PUT" });
}
export function untagItem(tagId: string, itemId: string): Promise<void> {
  return api<void>(`/api/tags/${tagId}/items/${itemId}`, { method: "DELETE" });
}
export function previewQuickAdd(body: QuickAddPreviewRequest): Promise<QuickAddPreviewResponse> {
  return api<QuickAddPreviewResponse>("/api/tags/preview", { method: "POST", body: JSON.stringify(body) });
}
export function quickAddToTag(tagId: string, body: QuickAddItemRequest): Promise<QuickAddItemResponse> {
  return api<QuickAddItemResponse>(`/api/tags/${tagId}/quick-add`, { method: "POST", body: JSON.stringify(body) });
}
export function searchTagCandidates(tagId: string, q: string, skill?: string): Promise<TagCandidatesResponse> {
  const p = new URLSearchParams({ q });
  if (skill) p.set("skill", skill);
  return api<TagCandidatesResponse>(`/api/tags/${tagId}/candidates?${p.toString()}`);
}

// ----- Lessons (Phase 2) -----
import type {
  CreateLessonRequest, CreateLessonResponse, LessonsListResponse,
  LessonDetail, LessonStatusResponse, TodayLessonResponse, LessonStateUpdate,
  GrammarPointsResponse,
} from "@nihongo/shared";

export function createLesson(body: CreateLessonRequest): Promise<CreateLessonResponse> {
  return api<CreateLessonResponse>("/api/lessons", { method: "POST", body: JSON.stringify(body) });
}
export function fetchGrammarPoints(level: string): Promise<GrammarPointsResponse> {
  return api<GrammarPointsResponse>(`/api/grammar-points?level=${level}`);
}
export function fetchLessons(): Promise<LessonsListResponse> {
  return api<LessonsListResponse>("/api/lessons");
}
export function fetchLessonDetail(id: string): Promise<LessonDetail> {
  return api<LessonDetail>(`/api/lessons/${id}`);
}
export function fetchLessonStatus(id: string): Promise<LessonStatusResponse> {
  return api<LessonStatusResponse>(`/api/lessons/${id}/status`);
}
export function fetchTodayLesson(): Promise<TodayLessonResponse> {
  return api<TodayLessonResponse>("/api/lessons/today");
}
export function updateLessonState(id: string, body: LessonStateUpdate): Promise<void> {
  return api<void>(`/api/lessons/${id}/state`, { method: "PATCH", body: JSON.stringify(body) });
}
