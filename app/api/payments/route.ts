// FR-06 테스트 결제: 실제 돈이 오가지 않는 자체 모의 결제(결제사 연동 없음). (쓰기: 결제 모듈)
// 같은 idempotencyKey로 다시 오면 처음 결과를 돌려준다.
import { db } from "@/lib/supabase-admin";
import { requireUser } from "@/lib/auth";
import { requireMember } from "@/lib/access";
import { handle, ok, readJson, HttpError } from "@/lib/http";
import { accessInfo } from "@/lib/entitlement";
import { str, oneOf } from "@/lib/validate";
import { PRODUCTS } from "@/lib/config";


export const POST = handle(async (req) => {
  const user = await requireUser(req);
  const body = await readJson(req);
  const product = oneOf(body, "product", ["course_pass", "exam_30d"] as const, "상품");
  const courseId = str(body, "courseId", { label: "과목", max: 64 });
  const card = body.card === undefined ? "ok" : oneOf(body, "card", ["ok", "fail"] as const, "테스트 카드");
  await requireMember(user.id, courseId);
  const key = str(body, "idempotencyKey", { label: "결제 요청 정보", max: 80 });
  if (!/^[A-Za-z0-9-]{16,80}$/.test(key)) throw new HttpError(400, "invalid", "결제 요청 정보가 올바르지 않아요. 새로고침 후 다시 시도해 주세요");

  const { data: prev, error } = await db().from("payments").select("status, user_id").eq("idempotency_key", key).maybeSingle();
  if (error) throw error;
  if (prev) {
    if (prev.user_id !== user.id) throw new HttpError(409, "conflict", "결제 요청이 겹쳤어요. 새로고침 후 다시 시도해 주세요");
    if (prev.status === "failed") throw new HttpError(402, "declined", "카드 승인이 거절됐어요(테스트)");
    return ok({ status: "paid", access: await accessInfo(user.id, courseId) });
  }

  if ((await accessInfo(user.id, courseId)).has) throw new HttpError(409, "already_has", "이미 이용권이 있어요");

  const { amount } = PRODUCTS[product];
  const failed = card === "fail";
  const { data: payment, error: e2 } = await db()
    .from("payments")
    .insert({
      user_id: user.id,
      product,
      course_id: courseId,
      amount,
      provider: "mock",
      status: failed ? "failed" : "paid",
      fail_reason: failed ? "테스트 실패 카드" : null,
      idempotency_key: key,
    })
    .select("id")
    .single();
  if (e2?.code === "23505") return ok({ status: "paid", access: await accessInfo(user.id, courseId) });
  if (e2) throw e2;
  if (failed) throw new HttpError(402, "declined", "카드 승인이 거절됐어요(테스트)");

  const { error: e3 } = await db().from("entitlements").insert({
    user_id: user.id,
    kind: product,
    course_id: product === "course_pass" ? courseId : null,
    payment_id: payment.id,
    expires_at: product === "exam_30d" ? new Date(Date.now() + PRODUCTS.exam_30d.days * 24 * 60 * 60 * 1000).toISOString() : null,
  });
  if (e3) throw e3;
  return ok({ status: "paid", access: await accessInfo(user.id, courseId) });
});
