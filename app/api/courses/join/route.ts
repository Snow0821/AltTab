// FR-01 참여 코드로 들어가기 (쓰기: 인증·과목 모듈)
import { db } from "@/lib/supabase-admin";
import { requireUser } from "@/lib/auth";
import { handle, ok, readJson, HttpError } from "@/lib/http";
import { str } from "@/lib/validate";

export const POST = handle(async (req) => {
  const user = await requireUser(req);
  const joinCode = str(await readJson(req), "code", { label: "참여 코드", max: 20 }).replace(/\s/g, "").toUpperCase();
  const { data: course, error } = await db().from("courses").select("id").eq("join_code", joinCode).maybeSingle();
  if (error) throw error;
  if (!course) throw new HttpError(404, "no_code", "참여 코드를 찾을 수 없어요");
  const { error: e2 } = await db()
    .from("course_members")
    .upsert({ course_id: course.id, user_id: user.id, role: "member" }, { onConflict: "course_id,user_id", ignoreDuplicates: true });
  if (e2) throw e2;
  return ok({ courseId: course.id });
});
