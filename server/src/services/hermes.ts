// Fire-and-forget delivery of study-progress events to the user's Hermes inbox
// (hermes-jester), so the Hermes agent (Eva) can track Japanese progress.
//
// Opt-in: a complete no-op unless BOTH HERMES_BASE_URL and HERMES_WRITE_KEY are
// set, which keeps dev / test / CI clean. Never throws into the caller — every
// failure is logged and swallowed. Events are the Cadence/Eva envelope shape
// `{ event_type, occurred_at, data }`, submitted to the single Hermes type
// `nihongo_event` (POST /api/item/nihongo_event, Bearer write key).

export type ReviewLoggedData = {
  item_id: string;
  skill: string;
  result: "got_it" | "missed";
  reviewed_at: string;
  box_before: number;
  box_after: number;
  total_reviews: number;
  total_missed: number;
  suspended: boolean;
  session_id: string | null;
  front: string;
  meaning: string;
};

export type MilestoneData = {
  milestone_type: "streak";
  streak_days: number;
  session_date: string;
  item_id: string;
};

type HermesConfig = { baseUrl: string; writeKey: string };

// Read live from the environment (not the frozen `env`) so the integration can
// be toggled in tests and stays a runtime opt-in.
function hermesConfig(): HermesConfig | null {
  const baseUrl = process.env.HERMES_BASE_URL;
  const writeKey = process.env.HERMES_WRITE_KEY;
  if (!baseUrl || !writeKey) return null;
  return { baseUrl: baseUrl.replace(/\/+$/, ""), writeKey };
}

export function hermesConfigured(): boolean {
  return hermesConfig() !== null;
}

export async function postEvent(
  eventType: "review_logged" | "milestone",
  occurredAt: string,
  data: unknown,
): Promise<void> {
  const cfg = hermesConfig();
  if (!cfg) return; // opt-in: no-op when unconfigured
  const body = JSON.stringify({ event_type: eventType, occurred_at: occurredAt, data });
  try {
    const res = await fetch(`${cfg.baseUrl}/api/item/nihongo_event`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.writeKey}`,
        "Content-Type": "application/json",
      },
      body,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(`hermes: POST nihongo_event ${eventType} -> ${res.status} ${detail}`.trim());
    }
  } catch (err) {
    console.error("hermes: POST nihongo_event failed", err);
  }
}

export function emitReviewLogged(data: ReviewLoggedData): Promise<void> {
  return postEvent("review_logged", data.reviewed_at, data);
}

export function emitMilestone(data: MilestoneData, occurredAt: string): Promise<void> {
  return postEvent("milestone", occurredAt, data);
}
