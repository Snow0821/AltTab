// 문항 상태와 출제 대상 규칙(소유: MCP·검수 모듈, PRD 4절 자동 상태 판정). 퀴즈 모듈은 읽기만 한다.
import { db } from "./supabase-admin";

export type QuestionStatus = "first_pass" | "verified" | "hidden";

// 학생 U에게 출제할 수 있는 문항: 숨김이 아니고, (검증 완료) 또는 (U가 작성) 또는 (U가 2차 통과)
export async function playableQuestionIds(userId: string, conceptId: string, difficulty: number): Promise<string[]> {
  const { data: rows, error } = await db()
    .from("question_status")
    .select("question_id, author_id, status")
    .eq("concept_id", conceptId)
    .eq("difficulty", difficulty)
    .neq("status", "hidden");
  if (error) throw error;
  const candidates = rows ?? [];
  const needCheck = candidates.filter((r) => r.status !== "verified" && r.author_id !== userId).map((r) => r.question_id);
  let passedByMe = new Set<string>();
  if (needCheck.length) {
    const { data: mine, error: e2 } = await db()
      .from("review_log")
      .select("question_id")
      .eq("reviewer_id", userId)
      .eq("stage", 2)
      .eq("verdict", "pass")
      .in("question_id", needCheck);
    if (e2) throw e2;
    passedByMe = new Set((mine ?? []).map((m) => m.question_id as string));
  }
  return candidates
    .filter((r) => r.status === "verified" || r.author_id === userId || passedByMe.has(r.question_id))
    .map((r) => r.question_id as string);
}

// 학생 U가 2차 검수할 수 있는 문항: 1차 통과 상태, U가 만들지 않았고, U가 아직 2차 검수하지 않은 것
export async function reviewableQuestionIds(userId: string, courseId: string, conceptIds?: string[]): Promise<string[]> {
  let query = db()
    .from("question_status")
    .select("question_id, concept_id")
    .eq("course_id", courseId)
    .eq("status", "first_pass")
    .neq("author_id", userId);
  if (conceptIds) query = query.in("concept_id", conceptIds.length ? conceptIds : ["00000000-0000-0000-0000-000000000000"]);
  const { data: rows, error } = await query;
  if (error) throw error;
  const ids = (rows ?? []).map((r) => r.question_id as string);
  if (!ids.length) return [];
  const { data: done, error: e2 } = await db()
    .from("review_log")
    .select("question_id")
    .eq("reviewer_id", userId)
    .eq("stage", 2)
    .in("question_id", ids);
  if (e2) throw e2;
  const reviewed = new Set((done ?? []).map((d) => d.question_id as string));
  return ids.filter((id) => !reviewed.has(id));
}

export async function statusOf(questionIds: string[]): Promise<Map<string, QuestionStatus>> {
  if (!questionIds.length) return new Map();
  const { data, error } = await db().from("question_status").select("question_id, status").in("question_id", questionIds);
  if (error) throw error;
  return new Map((data ?? []).map((r) => [r.question_id as string, r.status as QuestionStatus]));
}
