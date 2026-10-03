// FR-05 답 채점: 서버가 정답과 비교한다. 같은 문항·같은 회차를 다시 보내면 처음 결과를 그대로 돌려준다.
import { db } from "@/lib/supabase-admin";
import { requireUser } from "@/lib/auth";
import { handle, ok, readJson, HttpError } from "@/lib/http";
import { gradeChoice, gradeShort } from "@/lib/rules";
import { str, int } from "@/lib/validate";

export const POST = handle(async (req) => {
  const user = await requireUser(req);
  const body = await readJson(req);
  const attemptId = str(body, "attemptId", { label: "풀이 기록", max: 64 });
  const questionId = str(body, "questionId", { label: "문항", max: 64 });
  const answer = str(body, "answer", { label: "답", max: 500, optional: true }); // 빈 답은 오답으로 채점
  const round = int(body, "round", { label: "회차", min: 1, max: 2, optional: true }) ?? 1;
  const { data: attempt, error } = await db()
    .from("attempts")
    .select("id, user_id, question_ids, finished_at")
    .eq("id", attemptId)
    .maybeSingle();
  if (error) throw error;
  if (!attempt || attempt.user_id !== user.id) throw new HttpError(404, "not_found", "풀이 기록을 찾을 수 없어요");
  if (attempt.finished_at) throw new HttpError(409, "finished", "이미 끝난 스테이지예요");
  if (!(attempt.question_ids as string[]).includes(questionId)) throw new HttpError(400, "invalid", "이 스테이지의 문항이 아니에요");
  const { data: q, error: e2 } = await db()
    .from("questions")
    .select("qtype, answer, accepted_answers, explanation")
    .eq("id", questionId)
    .single();
  if (e2) throw e2;
  const accepted = [q.answer as string, ...((q.accepted_answers as string[]) ?? [])];
  const reply = (correct: boolean) =>
    ok({
      correct,
      correctAnswer: q.answer,
      acceptedAnswers: q.qtype === "short" ? [...new Set(accepted)] : [],
      explanation: q.explanation,
    });

  const { data: prev } = await db()
    .from("attempt_answers")
    .select("correct")
    .eq("attempt_id", attempt.id)
    .eq("question_id", questionId)
    .eq("round", round)
    .maybeSingle();
  if (prev) return reply(prev.correct as boolean);

  const correct = q.qtype === "choice" ? gradeChoice(answer, q.answer as string) : gradeShort(answer, accepted);
  const { error: e3 } = await db()
    .from("attempt_answers")
    .insert({ attempt_id: attempt.id, question_id: questionId, round, answer: answer || "(빈 답)", correct });
  if (e3 && e3.code !== "23505") throw e3;
  return reply(correct);
});
