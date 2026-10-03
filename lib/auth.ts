// 웹 API 인증: Authorization: Bearer <Supabase access token> 로 사용자를 확인한다.
// 요청 본문에 들어온 사용자 ID는 믿지 않는다.
import { db } from "./supabase-admin";
import { HttpError } from "./http";

export type User = { id: string; email: string };

export async function requireUser(req: Request): Promise<User> {
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) throw new HttpError(401, "login_required", "로그인이 필요해요");
  const { data, error } = await db().auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "login_required", "로그인이 필요해요");
  return { id: data.user.id, email: data.user.email ?? "" };
}
