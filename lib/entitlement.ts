// 이용권 확인(소유: 결제 모듈). 유효 = 이 과목의 과목 이용권(기간 제한 없음) 또는 만료 전 구독.
import { db } from "./supabase-admin";

export type Access = { has: boolean; kind: "course_pass" | "exam_30d" | null; expiresAt: string | null };

export async function accessInfo(userId: string, courseId: string): Promise<Access> {
  const { data, error } = await db()
    .from("entitlements")
    .select("kind, course_id, expires_at")
    .eq("user_id", userId)
    .or(`course_id.eq.${courseId},course_id.is.null`);
  if (error) throw error;
  const now = Date.now();
  const valid = (data ?? []).filter(
    (e) =>
      (e.kind === "course_pass" && e.course_id === courseId) ||
      (e.kind === "exam_30d" && e.expires_at && new Date(e.expires_at).getTime() > now),
  );
  const pass = valid.find((e) => e.kind === "course_pass");
  if (pass) return { has: true, kind: "course_pass", expiresAt: null };
  const sub = valid.sort((a, b) => String(b.expires_at).localeCompare(String(a.expires_at)))[0];
  if (sub) return { has: true, kind: "exam_30d", expiresAt: sub.expires_at };
  return { has: false, kind: null, expiresAt: null };
}

export async function hasAccess(userId: string, courseId: string): Promise<boolean> {
  return (await accessInfo(userId, courseId)).has;
}
