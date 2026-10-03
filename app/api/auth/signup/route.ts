// FR-01 가입: 확인 메일 없이 바로 쓸 수 있도록 서버에서 확인 완료 상태로 계정을 만든다.
// 로그인은 브라우저가 Supabase Auth에 직접 한다.
import { db } from "@/lib/supabase-admin";
import { handle, ok, readJson, HttpError } from "@/lib/http";

export const POST = handle(async (req) => {
  const { email, password } = await readJson<{ email?: string; password?: string }>(req);
  const mail = (email ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) throw new HttpError(400, "invalid", "이메일 형식을 확인해 주세요");
  if (!password || password.length < 6) throw new HttpError(400, "invalid", "비밀번호는 6자 이상이어야 해요");
  const { error } = await db().auth.admin.createUser({ email: mail, password, email_confirm: true });
  if (error) {
    if (/already|registered|exists/i.test(error.message)) {
      throw new HttpError(409, "exists", "이미 가입한 이메일이에요. 로그인해 주세요");
    }
    throw error;
  }
  return ok({ ok: true }, 201);
});
