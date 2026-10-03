// FR-05 문제 신고: 한 사람은 한 문항에 한 번. 신고 3건이면 숨김(question_status 뷰가 계산). (쓰기: 퀴즈 모듈)
import { db } from "@/lib/supabase-admin";
import { requireUser } from "@/lib/auth";
import { requireMember } from "@/lib/access";
import { handle, ok, readJson, HttpError } from "@/lib/http";
import { statusOf } from "@/lib/review";
import { oneOf } from "@/lib/validate";

const REASONS = ["wrong_answer", "ambiguous", "out_of_scope"] as const;

export const POST = handle(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const user = await requireUser(req);
  const reason = oneOf(await readJson(req), "reason", REASONS, "신고 사유");
  const { data: q, error } = await db().from("questions").select("course_id").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!q) throw new HttpError(404, "not_found", "문항을 찾을 수 없어요");
  await requireMember(user.id, q.course_id as string);
  const { error: e2 } = await db().from("reports").insert({ question_id: id, reporter_id: user.id, reason });
  if (e2?.code === "23505") throw new HttpError(409, "already", "이미 신고한 문항이에요");
  if (e2) throw e2;
  const status = (await statusOf([id])).get(id);
  return ok({ ok: true, hidden: status === "hidden" });
});
