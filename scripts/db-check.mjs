// 실제 Supabase에서 확인하는 통합 점검(필요: .env.local). 시험용 계정·과목은 끝에 지운다.
// 1) 과목을 만들면 owner 참여가 같은 트랜잭션에서 생긴다
// 2) owner 참여 저장에 실패를 주입하면 과목도 남지 않고, 다시 시도하면 정상 생성된다
// 3) 다른 계정은 참여 전에는 과목 참여 기록이 없고, 참여 코드로 들어오면 member가 된다
import { readFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { createClient } from "@supabase/supabase-js";

if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
  }
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
const pgUrl = process.env.POSTGRES_URL_NON_POOLING ?? process.env.POSTGRES_URL;
if (!url || !key || !pgUrl) {
  console.error("환경 변수가 없습니다. vercel env pull .env.local 을 먼저 실행하세요.");
  process.exit(1);
}
const admin = createClient(url, key, { auth: { persistSession: false } });
const sql = postgres(pgUrl, { ssl: "require", max: 1, onnotice: () => {} });
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "통과" : "실패"} | ${name}${detail ? ` | ${detail}` : ""}`);
};
const code = () => randomBytes(4).toString("hex").slice(0, 6).toUpperCase().replace(/[^A-Z0-9]/g, "A");
const users = [];
const courseIds = [];

try {
  for (const n of [1, 2]) {
    const email = `db-check-${Date.now()}-${n}@example.com`;
    const { data, error } = await admin.auth.admin.createUser({ email, password: randomBytes(12).toString("hex"), email_confirm: true });
    if (error) throw error;
    users.push(data.user.id);
  }
  const [owner, other] = users;

  // 1) 정상 생성
  const { data: c1, error: e1 } = await admin.from("courses").insert({ title: "점검 과목", join_code: code(), owner_id: owner }).select("id").single();
  if (e1) throw e1;
  courseIds.push(c1.id);
  const m1 = await sql`select role from course_members where course_id = ${c1.id} and user_id = ${owner}`;
  check("과목 생성 시 owner 참여가 함께 생긴다", m1.length === 1 && m1[0].role === "owner");

  // 2) 실패 주입: owner 참여 저장이 실패하면 과목도 남지 않아야 한다
  await sql.unsafe(`
    create or replace function db_check_fail_member() returns trigger language plpgsql as $$
    begin
      if exists (select 1 from courses where id = new.course_id and title = '__inject_fail__') then
        raise exception 'injected member failure';
      end if;
      return new;
    end $$;
    drop trigger if exists db_check_fail_member on course_members;
    create trigger db_check_fail_member before insert on course_members for each row execute function db_check_fail_member();
  `);
  const { error: e2 } = await admin.from("courses").insert({ title: "__inject_fail__", join_code: code(), owner_id: owner }).select("id").single();
  const orphan = await sql`select count(*)::int as n from courses where title = '__inject_fail__'`;
  check("참여 저장 실패 시 요청이 실패한다", !!e2, e2?.message ?? "오류 없음");
  check("참여 저장 실패 시 고아 과목이 남지 않는다", orphan[0].n === 0, `남은 과목 ${orphan[0].n}개`);
  await sql.unsafe(`drop trigger if exists db_check_fail_member on course_members; drop function if exists db_check_fail_member();`);
  const { data: c2, error: e3 } = await admin.from("courses").insert({ title: "__inject_retry__", join_code: code(), owner_id: owner }).select("id").single();
  if (c2) courseIds.push(c2.id);
  const m2 = c2 ? await sql`select role from course_members where course_id = ${c2.id}` : [];
  check("실패 뒤 다시 시도하면 과목과 owner 참여가 정상 생성된다", !e3 && m2.length === 1);

  // 3) 다른 계정
  const before = await sql`select count(*)::int as n from course_members where course_id = ${c1.id} and user_id = ${other}`;
  check("다른 계정은 참여 전에는 과목 참여 기록이 없다", before[0].n === 0);
  await admin.from("course_members").insert({ course_id: c1.id, user_id: other, role: "member" });
  const after = await sql`select role from course_members where course_id = ${c1.id} and user_id = ${other}`;
  check("참여 후 다른 계정은 member다", after.length === 1 && after[0].role === "member");

  // 4) 문항과 1차 검수 기록은 함께 저장되거나 함께 취소된다(submit_question)
  const { data: concept, error: ec } = await admin
    .from("concepts")
    .insert({ course_id: c1.id, author_id: owner, name: "점검 개념", summary: "점검용", evidence_refs: ["1:1"] })
    .select("id")
    .single();
  if (ec) throw ec;
  const q = (body) => ({
    course_id: c1.id, concept_id: concept.id, author_id: owner, difficulty: 3, qtype: "short", body, body_norm: body,
    choices: null, answer: "LIFO", accepted_answers: ["LIFO", "후입선출"], explanation: "점검", evidence_refs: ["1:1"], check_note: "점검", evidence_score: 0.5,
  });
  const checklist = { answer_correct: true, evidence_match: true, difficulty_fit: true, choices_clear: true };
  const { data: qid, error: eq } = await admin.rpc("submit_question", { p: q("스택의 꺼내는 순서는?"), p_checklist: checklist, p_reason: "점검" });
  const logs = qid ? await sql`select stage from review_log where question_id = ${qid}` : [];
  check("문항 저장 시 1차 검수 기록이 함께 생긴다", !eq && logs.length === 1 && logs[0].stage === 1, eq?.message ?? "");
  await sql.unsafe(`
    create or replace function db_check_fail_review() returns trigger language plpgsql as $$
    begin
      if new.reason = '__inject_fail__' then raise exception 'injected review failure'; end if;
      return new;
    end $$;
    drop trigger if exists db_check_fail_review on review_log;
    create trigger db_check_fail_review before insert on review_log for each row execute function db_check_fail_review();
  `);
  const { error: ef } = await admin.rpc("submit_question", { p: q("큐의 꺼내는 순서는?"), p_checklist: checklist, p_reason: "__inject_fail__" });
  const leftover = await sql`select count(*)::int as n from questions where body = '큐의 꺼내는 순서는?'`;
  check("검수 기록 저장 실패 시 문항도 남지 않는다", !!ef && leftover[0].n === 0, `남은 문항 ${leftover[0].n}개`);
  await sql.unsafe(`drop trigger if exists db_check_fail_review on review_log; drop function if exists db_check_fail_review();`);
  const { error: er } = await admin.rpc("submit_question", { p: q("큐의 꺼내는 순서는?"), p_checklist: checklist, p_reason: "점검" });
  check("실패 뒤 다시 보내면 문항과 검수 기록이 정상 저장된다", !er, er?.message ?? "");

  // 5) 익명 키로는 표를 읽을 수 없다(RLS)
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (anonKey) {
    const anon = createClient(url, anonKey, { auth: { persistSession: false } });
    const { data: rows } = await anon.from("courses").select("id").limit(1);
    const { data: view } = await anon.from("question_status").select("question_id").limit(1);
    check("익명 키로 courses를 읽을 수 없다", !rows || rows.length === 0);
    check("익명 키로 question_status를 읽을 수 없다", !view || view.length === 0);
  }
} catch (e) {
  check("점검 실행", false, e.message);
} finally {
  if (courseIds.length) await sql`delete from courses where id in ${sql(courseIds)}`;
  await sql`delete from courses where title in ('__inject_fail__', '__inject_retry__')`;
  for (const id of users) await admin.auth.admin.deleteUser(id);
  await sql.end();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`결과: ${results.length - failed}/${results.length} 통과`);
  process.exitCode = failed ? 1 : 0;
}
