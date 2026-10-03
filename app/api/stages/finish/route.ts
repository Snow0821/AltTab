// FR-05 스테이지 종료: 1회차 정답으로 클리어·XP·별·숙련도를 정한다. 두 번 불러도 XP는 한 번만 쌓인다.
import { db } from "@/lib/supabase-admin";
import { requireUser } from "@/lib/auth";
import { handle, ok, readJson, HttpError } from "@/lib/http";
import { loadStages } from "@/lib/quiz";
import { scoreAttempt, nextStars, nextMastery, STAGE_SIZE } from "@/lib/rules";
import { str } from "@/lib/validate";

const DAY = 24 * 60 * 60 * 1000;

export const POST = handle(async (req) => {
  const user = await requireUser(req);
  const attemptId = str(await readJson(req), "attemptId", { label: "풀이 기록", max: 64 });
  const { data: attempt, error } = await db()
    .from("attempts")
    .select("id, user_id, course_id, concept_id, difficulty, question_ids, finished_at, correct_count, cleared, xp_gained")
    .eq("id", attemptId)
    .maybeSingle();
  if (error) throw error;
  if (!attempt || attempt.user_id !== user.id) throw new HttpError(404, "not_found", "풀이 기록을 찾을 수 없어요");

  // 먼저 끝난 표시를 한 요청만 아래 계산을 한다
  const { data: claimed, error: e1 } = await db()
    .from("attempts")
    .update({ finished_at: new Date().toISOString() })
    .eq("id", attempt.id)
    .is("finished_at", null)
    .select("id");
  if (e1) throw e1;
  if (!claimed?.length) {
    return ok({ alreadyFinished: true, cleared: attempt.cleared, correctCount: attempt.correct_count, xp: { total: attempt.xp_gained ?? 0 } });
  }

  const { data: answers, error: e2 } = await db()
    .from("attempt_answers")
    .select("question_id, correct")
    .eq("attempt_id", attempt.id)
    .eq("round", 1);
  if (e2) throw e2;
  const correctById = new Map((answers ?? []).map((a) => [a.question_id as string, a.correct as boolean]));
  const firstRound = (attempt.question_ids as string[]).map((id) => correctById.get(id) ?? false);
  const score = scoreAttempt(firstRound);

  const { data: prog } = await db()
    .from("stage_progress")
    .select("stars, mastery, review_interval_days")
    .eq("user_id", user.id)
    .eq("concept_id", attempt.concept_id)
    .maybeSingle();
  const starsBefore = (prog?.stars as number) ?? 0;
  const masteryBefore = (prog?.mastery as number) ?? 0;
  const starsAfter = nextStars(starsBefore, attempt.difficulty as number, score.cleared);
  const masteryAfter = nextMastery(masteryBefore, score.correct / STAGE_SIZE);
  // 다음 복습 시각(FR-08): 클리어하면 1일 → 3일 → 7일…, 못 하면 10분 뒤
  const prevInterval = (prog?.review_interval_days as number) ?? 0;
  const interval = score.cleared ? (prevInterval >= 1 ? Math.min(prevInterval * 2 + 1, 30) : 1) : 10 / (24 * 60);

  const { error: e3 } = await db().from("stage_progress").upsert(
    {
      user_id: user.id,
      concept_id: attempt.concept_id,
      course_id: attempt.course_id,
      stars: starsAfter,
      mastery: masteryAfter,
      review_interval_days: interval,
      next_review_at: new Date(Date.now() + interval * DAY).toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,concept_id" },
  );
  if (e3) throw e3;

  const xpRows = (["correct", "clear", "perfect"] as const)
    .filter((k) => score.xp[k] > 0)
    .map((k) => ({ user_id: user.id, course_id: attempt.course_id, attempt_id: attempt.id, amount: score.xp[k], reason: k }));
  if (xpRows.length) {
    const { error: e4 } = await db().from("xp_log").insert(xpRows);
    if (e4) throw e4;
  }
  const { error: e5 } = await db()
    .from("attempts")
    .update({ correct_count: score.correct, cleared: score.cleared, xp_gained: score.xp.total })
    .eq("id", attempt.id);
  if (e5) throw e5;

  let unlockedConceptId: string | null = null;
  if (starsBefore === 0 && starsAfter >= 1) {
    const { stages } = await loadStages(user.id, attempt.course_id);
    const i = stages.findIndex((s) => s.conceptId === attempt.concept_id);
    const next = stages[i + 1];
    if (next && next.state !== "locked") unlockedConceptId = next.conceptId;
  }

  return ok({
    cleared: score.cleared,
    correctCount: score.correct,
    total: STAGE_SIZE,
    xp: score.xp,
    stars: { before: starsBefore, after: starsAfter },
    mastery: { before: masteryBefore, after: masteryAfter },
    unlockedConceptId,
  });
});
