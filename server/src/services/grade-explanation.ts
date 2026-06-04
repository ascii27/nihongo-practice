import { gradeExplanationRaw, toRubyHtml, computeCost } from "@nihongo/gen";
import type { ExplainGrade, ExplainPrompt, ReviewResult } from "@nihongo/shared";
import { pool } from "../db/pool.js";

type AnthropicLike = { messages: { create: (body: unknown, opts?: { signal?: AbortSignal }) => Promise<unknown> } };

const PASS_THRESHOLD = 0.6;

export function gradeToResult(overall: number): ReviewResult {
  return overall >= PASS_THRESHOLD ? "got_it" : "missed";
}

export async function gradeExplanation(args: {
  item_id: string;
  answer_given: string;
  client?: AnthropicLike;
  signal?: AbortSignal;
}): Promise<{ grade: ExplainGrade; result: ReviewResult; cost_usd: number }> {
  const itemRes = await pool.query<{ skill: string; prompt: unknown }>(
    `SELECT skill, prompt FROM items WHERE id = $1`, [args.item_id],
  );
  if (itemRes.rowCount === 0) throw new Error("item not found");
  const row = itemRes.rows[0]!;
  if (row.skill !== "explain") throw new Error("item is not an explain item");
  const prompt = row.prompt as ExplainPrompt;

  const { grade: rawGrade, usage } = await gradeExplanationRaw({
    task_english: prompt.task_english,
    required_connectives: prompt.required_connectives,
    register: prompt.register,
    answer_given: args.answer_given,
    client: args.client,
    signal: args.signal,
  });

  const corrected_ruby = await toRubyHtml(rawGrade.corrected_japanese);
  const grade: ExplainGrade = {
    connective_use: rawGrade.connective_use,
    structure: rawGrade.structure,
    register: rawGrade.register,
    grammar: rawGrade.grammar,
    overall: rawGrade.overall,
    corrected_ruby,
    feedback: rawGrade.feedback,
  };
  return { grade, result: gradeToResult(grade.overall), cost_usd: computeCost(usage) };
}
