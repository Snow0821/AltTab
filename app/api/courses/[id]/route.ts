// 과목 홈에 필요한 기본 정보 (읽기 전용)
import { db } from "@/lib/supabase-admin";
import { requireUser } from "@/lib/auth";
import { requireMember } from "@/lib/access";
import { handle, ok } from "@/lib/http";
import { accessInfo } from "@/lib/entitlement";

export const GET = handle(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const user = await requireUser(req);
  const role = await requireMember(user.id, id);
  const { data: course, error } = await db().from("courses").select("id, title, join_code").eq("id", id).single();
  if (error) throw error;
  return ok({
    course: { id: course.id, title: course.title, joinCode: course.join_code, role },
    access: await accessInfo(user.id, id),
  });
});
