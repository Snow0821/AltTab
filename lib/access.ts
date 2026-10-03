// 과목 접근 확인(소유: 인증·과목 모듈). 모든 과목 단위 API와 MCP 도구가 먼저 부른다.
import { db } from "./supabase-admin";
import { HttpError } from "./http";

export async function requireMember(userId: string, courseId: string): Promise<"owner" | "member"> {
  if (!/^[0-9a-f-]{36}$/i.test(courseId)) throw new HttpError(404, "not_found", "과목을 찾을 수 없어요");
  const { data, error } = await db()
    .from("course_members")
    .select("role")
    .eq("course_id", courseId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(403, "not_member", "이 과목에 참여하지 않았어요");
  return data.role as "owner" | "member";
}
