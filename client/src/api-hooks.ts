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
  Skill,
} from "@nihongo/shared";

export function fetchQueue(skill?: Skill): Promise<QueueResponse> {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const params = new URLSearchParams({ tz });
  if (skill) params.set("skill", skill);
  return api<QueueResponse>(`/api/queue?${params.toString()}`);
}

export function fetchStreak(): Promise<StreakResponse> {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  return api<StreakResponse>(`/api/stats/streak?tz=${encodeURIComponent(tz)}`);
}

export function fetchDashboard(): Promise<DashboardResponse> {
  return api<DashboardResponse>(`/api/dashboard`);
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
}): Promise<ReviewStateResponse> {
  return api<ReviewStateResponse>("/api/reviews", {
    method: "POST",
    body: JSON.stringify(input),
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

// ----- Lessons (Phase 2) -----
import type {
  CreateLessonRequest, CreateLessonResponse, LessonsListResponse,
  LessonDetail, LessonStatusResponse, TodayLessonResponse, LessonStateUpdate,
} from "@nihongo/shared";

export function createLesson(body: CreateLessonRequest): Promise<CreateLessonResponse> {
  return api<CreateLessonResponse>("/api/lessons", { method: "POST", body: JSON.stringify(body) });
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
