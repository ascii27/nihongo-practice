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
  Skill,
} from "@nihongo/shared";

// `free` asks for a free-practice session: a fixed-size drill of one skill that
// ignores the daily budget, and whose reviews don't count against the target.
export function fetchQueue(skill?: Skill, opts: { free?: boolean } = {}): Promise<QueueResponse> {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const params = new URLSearchParams({ tz });
  if (skill) params.set("skill", skill);
  if (opts.free) params.set("free", "1");
  return api<QueueResponse>(`/api/queue?${params.toString()}`);
}

export function fetchStreak(): Promise<StreakResponse> {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  return api<StreakResponse>(`/api/stats/streak?tz=${encodeURIComponent(tz)}`);
}

function browserTz(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export function fetchDashboard(): Promise<DashboardResponse> {
  return api<DashboardResponse>(`/api/dashboard?tz=${encodeURIComponent(browserTz())}`);
}

// Unlocks one more full daily target. Returns the refreshed dashboard payload
// so the caller can swap state without a second fetch.
export function unlockAnotherRound(): Promise<DashboardResponse> {
  return api<DashboardResponse>(`/api/dashboard/round?tz=${encodeURIComponent(browserTz())}`, {
    method: "POST",
  });
}

export function fetchStatsBySkill(): Promise<StatsBySkillResponse> {
  return api<StatsBySkillResponse>(`/api/stats/by-skill`);
}

export function fetchLibrary(): Promise<LibraryResponse> {
  return api<LibraryResponse>(`/api/library`);
}

export function fetchStatsOverview(): Promise<StatsOverviewResponse> {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  return api<StatsOverviewResponse>(`/api/stats/overview?tz=${encodeURIComponent(tz)}`);
}

export function startSession(skill?: Skill): Promise<StartSessionResponse> {
  return api<StartSessionResponse>("/api/sessions", {
    method: "POST",
    body: JSON.stringify({ skill_filter: skill ?? "vocab" }),
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
  free_practice?: boolean;
}): Promise<ReviewStateResponse> {
  // Attach the caller's IANA timezone so the server can detect streak
  // milestones ("first review of today"). Harmless if the field is unused.
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return api<ReviewStateResponse>("/api/reviews", {
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

export function regenerateKanjiMnemonic(character: string): Promise<KanjiMnemonic> {
  return api<KanjiMnemonic>(
    `/api/kanji/${encodeURIComponent(character)}/mnemonic/regenerate`,
    { method: "POST" },
  );
}

// ----- Study lists -----
import type {
  StudyListsResponse, StudyListDetail, CreateStudyListRequest, CreateStudyListResponse,
  QuickAddStudyItemRequest, QuickAddStudyItemResponse, StudyCandidatesResponse, StudyCramResponse,
  StudyPreviewRequest, StudyPreviewResponse,
} from "@nihongo/shared";

export function fetchStudyLists(): Promise<StudyListsResponse> {
  return api<StudyListsResponse>("/api/study-lists");
}
export function fetchStudyList(id: string): Promise<StudyListDetail> {
  return api<StudyListDetail>(`/api/study-lists/${id}`);
}
export function createStudyList(body: CreateStudyListRequest): Promise<CreateStudyListResponse> {
  return api<CreateStudyListResponse>("/api/study-lists", { method: "POST", body: JSON.stringify(body) });
}
export function deleteStudyList(id: string): Promise<void> {
  return api<void>(`/api/study-lists/${id}`, { method: "DELETE" });
}
export function addStudyItem(listId: string, itemId: string): Promise<{ status: string }> {
  return api<{ status: string }>(`/api/study-lists/${listId}/items`, {
    method: "POST", body: JSON.stringify({ item_id: itemId }),
  });
}
export function previewStudyItem(body: StudyPreviewRequest): Promise<StudyPreviewResponse> {
  return api<StudyPreviewResponse>("/api/study-lists/preview", {
    method: "POST", body: JSON.stringify(body),
  });
}
export function quickAddStudyItem(listId: string, body: QuickAddStudyItemRequest): Promise<QuickAddStudyItemResponse> {
  return api<QuickAddStudyItemResponse>(`/api/study-lists/${listId}/quick-add`, {
    method: "POST", body: JSON.stringify(body),
  });
}
export function removeStudyItem(listId: string, itemId: string): Promise<void> {
  return api<void>(`/api/study-lists/${listId}/items/${itemId}`, { method: "DELETE" });
}
export function searchStudyCandidates(listId: string, q: string, skill?: string): Promise<StudyCandidatesResponse> {
  const params = new URLSearchParams({ q });
  if (skill) params.set("skill", skill);
  return api<StudyCandidatesResponse>(`/api/study-lists/${listId}/candidates?${params.toString()}`);
}
export function fetchStudyCram(listId: string): Promise<StudyCramResponse> {
  return api<StudyCramResponse>(`/api/study-lists/${listId}/cram`);
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
