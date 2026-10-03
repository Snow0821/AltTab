// FR-01 가입: 확인 메일 없이 바로 쓸 수 있도록 서버에서 확인 완료 상태로 계정을 만든다.
// 로그인은 브라우저가 Supabase Auth에 직접 한다.
import { db } from "@/lib/supabase-admin";
import { handle, ok, readJson, HttpError } from "@/lib/http";
import { str, InvalidInput } from "@/lib/validate";
import { LIMITS } from "@/lib/config";

// 확인 메일을 생략하는 대신 같은 접속 주소(IP)에서 한 시간에 60번까지만 가입을 시도할 수 있다.
// 대회장·강의실처럼 여러 사람이 한 주소를 쓰는 경우를 막지 않으면서 대량 자동 가입만 막는 값이다.
const SIGNUP_LIMIT_PER_HOUR = LIMITS.signupPerHour; // lib/config.ts

function clientIp(req: Request) {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
}

export const POST = handle(async (req) => {
  const body = await readJson(req);
  const mail = str(body, "email", { label: "이메일", max: 254 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) throw new HttpError(400, "invalid", "이메일 형식을 확인해 주세요");
  if (typeof body.password !== "string") throw new InvalidInput("비밀번호 형식이 올바르지 않아요");
  const password = body.password;
  if (password.length < 6 || password.length > 72) throw new HttpError(400, "invalid", "비밀번호는 6~72자여야 해요");

  const ip = clientIp(req);
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count, error: e0 } = await db()
    .from("signup_attempts")
    .select("ip", { count: "exact", head: true })
    .eq("ip", ip)
    .gte("created_at", since);
  if (e0) throw e0;
  if ((count ?? 0) >= SIGNUP_LIMIT_PER_HOUR) {
    throw new HttpError(429, "too_many", "가입 요청이 너무 많아요. 잠시 후 다시 시도해 주세요");
  }
  const { error: e1 } = await db().from("signup_attempts").insert({ ip });
  if (e1) throw e1;
  const { error } = await db().auth.admin.createUser({ email: mail, password, email_confirm: true });
  if (error) {
    if (/already|registered|exists/i.test(error.message)) {
      throw new HttpError(409, "exists", "이미 가입한 이메일이에요. 로그인해 주세요");
    }
    throw error;
  }
  return ok({ ok: true }, 201);
});
