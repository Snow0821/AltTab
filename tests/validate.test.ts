// 요청 본문 검사 회귀 테스트: 잘못된 입력은 500이 아니라 400 invalid여야 한다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { asObject, str, int, oneOf, arrayOf, InvalidInput } from "../lib/validate.ts";
import { handle, readJson } from "../lib/http.ts";

const post = (body: string) => new Request("http://localhost/api/test", { method: "POST", body, headers: { "Content-Type": "application/json" } });

// 가입 라우트와 같은 순서로 검사하는 대역 핸들러(DB 호출 전 단계만 재현)
const signupLike = handle(async (req: Request) => {
  const body = await readJson(req);
  const email = str(body, "email", { label: "이메일", max: 254 });
  if (typeof body.password !== "string") throw new InvalidInput("비밀번호 형식이 올바르지 않아요");
  return Response.json({ email });
});

test("본문이 객체가 아니면 400 invalid", async () => {
  for (const raw of ["null", "[]", "[1,2]", "123", "\"text\"", "true", "{잘못된 JSON", ""]) {
    const res = await signupLike(post(raw), {});
    assert.equal(res.status, 400, `입력 ${raw}`);
    assert.equal((await res.json()).error, "invalid");
  }
});

test("필드 자료형이 다르면 400 invalid", async () => {
  for (const raw of [
    `{"email":123,"password":"example123"}`,
    `{"email":{"a":1},"password":"example123"}`,
    `{"email":["a@b.c"],"password":"example123"}`,
    `{"email":"a@b.c","password":123456}`,
    `{"email":"a@b.c","password":null}`,
    `{"password":"example123"}`,
  ]) {
    const res = await signupLike(post(raw), {});
    assert.equal(res.status, 400, `입력 ${raw}`);
  }
});

test("올바른 입력은 통과", async () => {
  const res = await signupLike(post(`{"email":" a@b.c ","password":"example123"}`), {});
  assert.equal(res.status, 200);
  assert.equal((await res.json()).email, "a@b.c");
});

test("검사 함수 단위 동작", () => {
  assert.throws(() => asObject(null), InvalidInput);
  assert.throws(() => asObject([]), InvalidInput);
  assert.equal(str({ t: " 운영체제 " }, "t", { label: "과목 이름", max: 60 }), "운영체제");
  assert.throws(() => str({ t: "x".repeat(61) }, "t", { label: "과목 이름", max: 60 }), InvalidInput);
  assert.equal(str({}, "a", { label: "답", optional: true }), "");
  assert.equal(int({ n: 2 }, "n", { label: "회차", min: 1, max: 2 }), 2);
  assert.throws(() => int({ n: "2" }, "n", { label: "회차" }), InvalidInput);
  assert.throws(() => int({ n: 1.5 }, "n", { label: "회차" }), InvalidInput);
  assert.equal(oneOf({ p: "course_pass" }, "p", ["course_pass", "exam_30d"] as const, "상품"), "course_pass");
  assert.throws(() => oneOf({ p: 1 }, "p", ["course_pass"] as const, "상품"), InvalidInput);
  assert.throws(() => arrayOf({ a: {} }, "a", "쪽 목록", 10, (v) => v), InvalidInput);
  assert.throws(() => arrayOf({ a: [1, 2, 3] }, "a", "쪽 목록", 2, (v) => v), InvalidInput);
});
