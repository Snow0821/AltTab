// FR-01 과목 목록·만들기 (쓰기: 인증·과목 모듈)
import { randomInt } from "node:crypto";
import { db } from "@/lib/supabase-admin";
import { requireUser } from "@/lib/auth";
import { handle, ok, readJson, HttpError } from "@/lib/http";
import { hasAccess } from "@/lib/entitlement";

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 헷갈리는 0·O·1·I 제외

function newJoinCode() {
  return Array.from({ length: 6 }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join("");
}

export const GET = handle(async (req) => {
  const user = await requireUser(req);
  const { data: rows, error } = await db()
    .from("course_members")
    .select("role, courses(id, title, join_code, created_at)")
    .eq("user_id", user.id);
  if (error) throw error;
  const courses = [];
  for (const r of rows ?? []) {
    const c = r.courses as unknown as { id: string; title: string; join_code: string; created_at: string };
    const [{ count: total }, { data: prog }] = await Promise.all([
      db().from("concepts").select("id", { count: "exact", head: true }).eq("course_id", c.id),
      db().from("stage_progress").select("stars").eq("course_id", c.id).eq("user_id", user.id),
    ]);
    const stars = (prog ?? []).reduce((s, p) => s + (p.stars as number), 0);
    const cleared = (prog ?? []).filter((p) => (p.stars as number) >= 1).length;
    courses.push({
      id: c.id,
      title: c.title,
      joinCode: c.join_code,
      role: r.role,
      totalStages: total ?? 0,
      clearedStages: cleared,
      stars,
      hasAccess: await hasAccess(user.id, c.id),
      createdAt: c.created_at,
    });
  }
  courses.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return ok({ courses });
});

export const POST = handle(async (req) => {
  const user = await requireUser(req);
  const { title } = await readJson<{ title?: string }>(req);
  const name = (title ?? "").trim();
  if (name.length < 1 || name.length > 60) throw new HttpError(400, "invalid", "과목 이름은 1~60자로 적어 주세요");
  for (let i = 0; i < 5; i++) {
    const { data, error } = await db()
      .from("courses")
      .insert({ title: name, join_code: newJoinCode(), owner_id: user.id })
      .select("id, title, join_code")
      .single();
    if (error?.code === "23505") continue; // 참여 코드 충돌 시 다시 뽑기
    if (error) throw error;
    const { error: e2 } = await db().from("course_members").insert({ course_id: data.id, user_id: user.id, role: "owner" });
    if (e2) throw e2;
    return ok({ course: { id: data.id, title: data.title, joinCode: data.join_code } }, 201);
  }
  throw new HttpError(500, "server_error", "참여 코드를 만들지 못했어요. 다시 시도해 주세요");
});
