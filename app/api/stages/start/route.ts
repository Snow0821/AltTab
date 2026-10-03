// FR-05 스테이지 시작: 출제 가능 문항 5개를 고른다. 정답은 보내지 않는다. (소유: 퀴즈 모듈)
import { db } from "@/lib/supabase-admin";
import { requireUser } from "@/lib/auth";
import { requireMember } from "@/lib/access";
import { handle, ok, readJson, HttpError } from "@/lib/http";
import { loadStages } from "@/lib/quiz";
import { playableQuestionIds } from "@/lib/review";
import { currentDifficulty, STAGE_SIZE } from "@/lib/rules";
import { str } from "@/lib/validate";

function shuffle<T>(a: T[]): T[] {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}

export const POST = handle(async (req) => {
  const user = await requireUser(req);
  const body = await readJson(req);
  const courseId = str(body, "courseId", { label: "과목", max: 64 });
  const conceptId = str(body, "conceptId", { label: "스테이지", max: 64 });
  await requireMember(user.id, courseId);
  const { stages } = await loadStages(user.id, courseId);
  const stage = stages.find((s) => s.conceptId === conceptId);
  if (!stage) throw new HttpError(404, "not_found", "스테이지를 찾을 수 없어요");
  if (stage.state === "locked") throw new HttpError(403, "locked", "앞 스테이지를 먼저 깨 주세요");
  if (stage.state === "paywall") {
    throw new HttpError(402, "payment_required", "첫 유닛(스테이지 5개)까지는 무료예요. 6번째 스테이지부터는 이용권이 필요해요");
  }
  const difficulty = currentDifficulty(stage.stars);
  const ids = await playableQuestionIds(user.id, stage.conceptId, difficulty);
  if (ids.length < STAGE_SIZE) {
    throw new HttpError(409, "insufficient", `아직 ★${difficulty} 문항이 부족해요(현재 ${ids.length}개)`, { available: ids.length, difficulty });
  }
  const picked = shuffle(ids).slice(0, STAGE_SIZE);
  const { data: attempt, error } = await db()
    .from("attempts")
    .insert({ user_id: user.id, course_id: courseId, concept_id: stage.conceptId, difficulty, question_ids: picked })
    .select("id")
    .single();
  if (error) throw error;
  const { data: qs, error: e2 } = await db().from("questions").select("id, qtype, body, choices").in("id", picked);
  if (e2) throw e2;
  const byId = new Map((qs ?? []).map((q) => [q.id as string, q]));
  return ok({
    attemptId: attempt.id,
    conceptName: stage.name,
    difficulty,
    questions: picked.map((id) => {
      const q = byId.get(id)!;
      return { id, qtype: q.qtype, body: q.body, choices: q.choices ? shuffle(q.choices as string[]) : null };
    }),
  });
});
