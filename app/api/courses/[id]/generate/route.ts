// FR-12 웹에서 AI로 첫 유닛 문제 만들기(쓰기: AI 생성 모듈 ai_generations, 개념·문항은 MCP 도구 코드로 저장)
import { db } from "@/lib/supabase-admin";
import { requireUser } from "@/lib/auth";
import { requireMember } from "@/lib/access";
import { handle, ok, HttpError } from "@/lib/http";
import { AI } from "@/lib/config";
import { generateFirstUnit } from "@/lib/ai/generate";
import { TOOLS, ToolError } from "@/lib/mcp/tools";

export const maxDuration = 180;

const tool = (name: string) => TOOLS.find((t) => t.name === name)!;

// 한국 시간 오늘 0시(UTC 시각)
function startOfTodayKst(): string {
  const kst = new Date(Date.now() + 9 * 3600_000);
  kst.setUTCHours(0, 0, 0, 0);
  return new Date(kst.getTime() - 9 * 3600_000).toISOString();
}

export const POST = handle(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const { id: courseId } = await ctx.params;
  const user = await requireUser(req);
  await requireMember(user.id, courseId);

  const { data: ready, error: e0 } = await db().from("materials").select("id").eq("course_id", courseId).eq("status", "ready").limit(1);
  if (e0) throw e0;
  if (!ready?.length) throw new HttpError(409, "no_material", "교안을 먼저 올리고 분석이 끝나야 만들 수 있어요");

  const { data: running, error: e1 } = await db()
    .from("ai_generations")
    .select("id")
    .eq("course_id", courseId)
    .eq("status", "running")
    .gte("created_at", new Date(Date.now() - 4 * 60_000).toISOString())
    .limit(1);
  if (e1) throw e1;
  if (running?.length) throw new HttpError(409, "running", "이 과목에서 문제를 만드는 중이에요. 잠시 기다려 주세요");

  const { count, error: e2 } = await db()
    .from("ai_generations")
    .select("id", { count: "exact", head: true })
    .eq("course_id", courseId)
    .in("status", ["running", "done"])
    .gte("created_at", startOfTodayKst());
  if (e2) throw e2;
  if ((count ?? 0) >= AI.genDailyLimitPerCourse) {
    throw new HttpError(429, "daily_limit", `오늘은 이 과목에서 더 만들 수 없어요(하루 ${AI.genDailyLimitPerCourse}번)`);
  }

  const { data: gen, error: e3 } = await db().from("ai_generations").insert({ course_id: courseId, user_id: user.id }).select("id").single();
  if (e3) throw e3;
  const finish = (fields: Record<string, unknown>) =>
    db().from("ai_generations").update({ ...fields, finished_at: new Date().toISOString() }).eq("id", gen.id);

  // 1) 생성: 실패하면 아무것도 저장하지 않는다
  let result: Awaited<ReturnType<typeof generateFirstUnit>>;
  try {
    const { data: chunks, error } = await db()
      .from("chunks")
      .select("material_no, page, content")
      .eq("course_id", courseId)
      .order("id")
      .limit(400);
    if (error) throw error;
    result = await generateFirstUnit((chunks ?? []).map((c) => ({ ref: `${c.material_no}:${c.page}`, text: c.content })), req);
  } catch (e) {
    console.error("generation failed", e);
    await finish({ status: "failed", error: (e as Error).message.slice(0, 300) });
    throw new HttpError(502, "gen_failed", "문제를 만들지 못했어요. 잠시 후 다시 시도해 주세요");
  }

  // 2) 저장: MCP 도구와 같은 검사(형식, 근거 쪽 관련성, 중복)를 거친다
  const savedConceptIds: string[] = [];
  try {
    const c = (await tool("submit_concepts").run(user.id, { course_id: courseId, concepts: result.concepts }, req)) as {
      saved: { name: string; concept_id: string }[];
      existing: { name: string; concept_id: string }[];
    };
    savedConceptIds.push(...c.saved.map((s) => s.concept_id));
    const idOf = new Map([...c.saved, ...c.existing].map((s) => [s.name, s.concept_id]));
    const questions = result.questions
      .map((q) => ({ ...q, concept_id: idOf.get(String(q.concept ?? "")) }))
      .filter((q) => q.concept_id);
    let passed = 0;
    let rejected = result.questions.length - questions.length; // 개념을 찾지 못한 문항
    for (let i = 0; i < questions.length; i += 20) {
      const r = (await tool("submit_questions").run(user.id, { course_id: courseId, questions: questions.slice(i, i + 20) }, req)) as {
        passed: unknown[];
        rejected: unknown[];
      };
      passed += r.passed.length;
      rejected += r.rejected.length;
    }
    const made = result.questions.length;
    const conceptCount = idOf.size;
    await finish({
      status: "done",
      provider: result.provider,
      model: result.model,
      prompt_tokens: result.usage.prompt_tokens ?? null,
      completion_tokens: result.usage.completion_tokens ?? null,
      concepts_saved: conceptCount,
      questions_made: made,
      questions_passed: passed,
      questions_rejected: rejected,
      error: result.fallbackReason ? `대체 모델 사용: ${result.fallbackReason}`.slice(0, 300) : null,
    });
    return ok({
      concepts: conceptCount,
      made,
      passed,
      rejected,
      model: result.model,
      provider: result.provider,
      message: `개념 ${conceptCount}개, 문항 ${made}개를 만들었어요(1차 통과 ${passed}개, 반려 ${rejected}개)`,
    });
  } catch (e) {
    // 저장 도중 실패하면 이번에 새로 만든 개념(과 그 문항)을 지워 아무것도 남기지 않는다
    if (savedConceptIds.length) await db().from("concepts").delete().in("id", savedConceptIds);
    await finish({ status: "failed", error: (e as Error).message.slice(0, 300) });
    if (e instanceof ToolError) throw new HttpError(502, "gen_failed", `문제를 만들지 못했어요. 잠시 후 다시 시도해 주세요(${e.message})`);
    throw e;
  }
});
