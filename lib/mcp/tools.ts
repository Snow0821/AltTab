// MCP 도구 7개(FR-02·03, 소유: MCP·검수 모듈). 계약은 docs/설계.md 8절.
// 사용자는 주소의 토큰으로만 식별한다. 인자에 들어온 사용자 정보는 쓰지 않는다.
import { db } from "../supabase-admin";
import { requireMember } from "../access";
import { HttpError } from "../http";
import { embed, cosine, parseVector, EmbedError } from "../embed";
import { parseRef } from "../chunk";
import { normalizeText, orderStages, unitOf, type ConceptNode } from "../rules";
import { reviewableQuestionIds, statusOf } from "../review";

export class ToolError extends Error {}

type Args = Record<string, unknown>;
export type Tool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run: (userId: string, args: Args, req: Request) => Promise<unknown>;
};

const EVIDENCE_MIN = 0.25; // PRD FR-03 근거 불일치 기준
const IMPORTANCE_MIN = 0.35; // 개념과 관련 있다고 보는 청크 유사도
const CHECK_NAMES: Record<string, string> = {
  answer_correct: "정답",
  evidence_match: "근거 일치",
  difficulty_fit: "난이도",
  choices_clear: "선택지",
};

async function member(userId: string, courseId: unknown) {
  try {
    return await requireMember(userId, String(courseId ?? ""));
  } catch (e) {
    if (e instanceof HttpError) throw new ToolError(e.code === "not_found" ? "course_id가 올바르지 않아요. list_courses로 확인해 주세요" : e.message);
    throw e;
  }
}

const ref = (no: number, page: number) => `${no}:${page}`;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

async function existingRefs(courseId: string, refs: string[]): Promise<Set<string>> {
  const parsed = refs.map(parseRef).filter((r): r is { no: number; page: number } => !!r);
  if (!parsed.length) return new Set();
  const { data, error } = await db()
    .from("chunks")
    .select("material_no, page")
    .eq("course_id", courseId)
    .in("material_no", [...new Set(parsed.map((p) => p.no))])
    .in("page", [...new Set(parsed.map((p) => p.page))]);
  if (error) throw error;
  return new Set((data ?? []).map((c) => ref(c.material_no, c.page)));
}

async function chunksForRefs(courseId: string, refs: string[], max: number, withEmbedding = false) {
  const parsed = refs.map(parseRef).filter((r): r is { no: number; page: number } => !!r);
  if (!parsed.length) return [];
  const { data, error } = await db()
    .from("chunks")
    .select(withEmbedding ? "material_no, page, content, embedding" : "material_no, page, content")
    .eq("course_id", courseId)
    .in("material_no", [...new Set(parsed.map((p) => p.no))])
    .in("page", [...new Set(parsed.map((p) => p.page))])
    .order("id")
    .limit(200);
  if (error) throw error;
  const want = new Set(parsed.map((p) => ref(p.no, p.page)));
  return ((data ?? []) as unknown as { material_no: number; page: number; content: string; embedding?: unknown }[])
    .filter((c) => want.has(ref(c.material_no, c.page)))
    .slice(0, max);
}

function asStringArray(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  return v.map((x) => String(x ?? "").trim()).filter(Boolean);
}

const listCourses: Tool = {
  name: "list_courses",
  description: "내가 참여한 PassFinder 과목 목록을 돌려준다. 다른 도구에 넣을 course_id는 여기서 고른다.",
  inputSchema: { type: "object", properties: {} },
  async run(userId) {
    const { data, error } = await db().from("course_members").select("course_id, courses(title)").eq("user_id", userId);
    if (error) throw error;
    const out = [];
    for (const r of data ?? []) {
      const [{ count: materials }, { count: concepts }] = await Promise.all([
        db().from("materials").select("id", { count: "exact", head: true }).eq("course_id", r.course_id).eq("status", "ready"),
        db().from("concepts").select("id", { count: "exact", head: true }).eq("course_id", r.course_id),
      ]);
      out.push({ course_id: r.course_id, title: (r.courses as unknown as { title: string }).title, ready_materials: materials ?? 0, concepts: concepts ?? 0 });
    }
    if (!out.length) return { courses: [], message: "참여한 과목이 없어요. PassFinder 웹에서 과목을 만들거나 참여 코드로 들어가 주세요" };
    return { courses: out };
  },
};

const getCourseContext: Tool = {
  name: "get_course_context",
  description:
    "과목 교안의 글 조각을 위치 ref(교안번호:쪽, 예 '1:3')와 함께 돌려준다. query를 주면 뜻이 가까운 조각을, 없으면 앞에서부터 순서대로 준다. 다음 묶음은 받은 next_cursor를 cursor로 넘긴다. 개념과 문항의 근거 위치에는 이 ref를 그대로 쓴다.",
  inputSchema: {
    type: "object",
    properties: {
      course_id: { type: "string" },
      query: { type: "string", description: "찾을 내용(선택)" },
      cursor: { type: "integer", description: "이전 응답의 next_cursor(선택)" },
      limit: { type: "integer", minimum: 1, maximum: 60, description: "기본 30" },
    },
    required: ["course_id"],
  },
  async run(userId, args, req) {
    const courseId = String(args.course_id ?? "");
    await member(userId, courseId);
    const limit = Math.min(60, Math.max(1, Number(args.limit) || 30));
    const query = String(args.query ?? "").trim();
    if (query) {
      let vec: number[];
      try {
        [vec] = await embed([query], req);
      } catch {
        throw new ToolError("검색어를 처리하지 못했어요. query 없이 다시 불러 주세요");
      }
      const { data, error } = await db().rpc("match_chunks", { p_course: courseId, p_embedding: vec, p_limit: limit });
      if (error) throw error;
      const rows = (data ?? []) as { material_no: number; page: number; content: string; similarity: number }[];
      if (!rows.length) throw new ToolError("아직 분석된 교안이 없어요. 웹 과목 화면에서 교안 PDF를 먼저 올려 주세요");
      return { chunks: rows.map((r) => ({ ref: ref(r.material_no, r.page), text: r.content, similarity: Math.round(r.similarity * 100) / 100 })) };
    }
    const cursor = Number(args.cursor) || 0;
    const { data, error } = await db()
      .from("chunks")
      .select("id, material_no, page, content")
      .eq("course_id", courseId)
      .gt("id", cursor)
      .order("id")
      .limit(limit + 1);
    if (error) throw error;
    const rows = data ?? [];
    if (!rows.length && !cursor) throw new ToolError("아직 올린 교안이 없어요. 웹 과목 화면에서 교안 PDF를 먼저 올려 주세요");
    const page = rows.slice(0, limit);
    return {
      chunks: page.map((r) => ({ ref: ref(r.material_no, r.page), text: r.content })),
      next_cursor: rows.length > limit ? page[page.length - 1].id : null,
    };
  },
};

const submitConcepts: Tool = {
  name: "submit_concepts",
  description:
    "교안에서 뽑은 핵심 개념을 등록한다. 개념 하나가 스테이지 하나가 된다. summary는 300자 이내, evidence_refs는 get_course_context의 ref(예 '1:3')를 1개 이상, prerequisites는 먼저 알아야 하는 개념의 이름이다. 같은 이름이 이미 있으면 새로 만들지 않는다. 한 번에 30개까지.",
  inputSchema: {
    type: "object",
    properties: {
      course_id: { type: "string" },
      concepts: {
        type: "array",
        maxItems: 30,
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            summary: { type: "string", maxLength: 300 },
            evidence_refs: { type: "array", items: { type: "string" } },
            prerequisites: { type: "array", items: { type: "string" } },
          },
          required: ["name", "summary", "evidence_refs"],
        },
      },
    },
    required: ["course_id", "concepts"],
  },
  async run(userId, args, req) {
    const courseId = String(args.course_id ?? "");
    await member(userId, courseId);
    const list = Array.isArray(args.concepts) ? (args.concepts as Args[]) : [];
    if (!list.length) throw new ToolError("concepts가 비어 있어요");
    if (list.length > 30) throw new ToolError("개념은 한 번에 30개까지 보낼 수 있어요");
    const { data: have, error } = await db().from("concepts").select("id, name").eq("course_id", courseId);
    if (error) throw error;
    const byName = new Map((have ?? []).map((c) => [c.name as string, c.id as string]));
    const allRefs = list.flatMap((c) => asStringArray(c.evidence_refs) ?? []);
    const okRefs = await existingRefs(courseId, allRefs);
    const saved: { name: string; concept_id: string }[] = [];
    const existing: { name: string; concept_id: string }[] = [];
    const rejected: { name: string; reason: string }[] = [];
    const toInsert: Record<string, unknown>[] = [];
    for (const c of list) {
      const name = String(c.name ?? "").trim();
      const summary = String(c.summary ?? "").trim();
      const refs = asStringArray(c.evidence_refs) ?? [];
      if (!name) { rejected.push({ name: "(이름 없음)", reason: "누락: 이름" }); continue; }
      if (name.length > 60) { rejected.push({ name, reason: "이름은 60자 이내로 적어 주세요" }); continue; }
      if (byName.has(name)) { existing.push({ name, concept_id: byName.get(name)! }); continue; }
      if (!summary) { rejected.push({ name, reason: "누락: 요약" }); continue; }
      if (summary.length > 300) { rejected.push({ name, reason: `요약이 300자를 넘어요(${summary.length}자)` }); continue; }
      if (!refs.length) { rejected.push({ name, reason: "누락: 근거 위치" }); continue; }
      const bad = refs.find((r) => !parseRef(r));
      if (bad) { rejected.push({ name, reason: `근거 위치 형식이 틀렸어요: ${bad} (예 1:3)` }); continue; }
      const missing = refs.find((r) => !okRefs.has(r));
      if (missing) { rejected.push({ name, reason: `교안에 없는 쪽이에요: ${missing}` }); continue; }
      byName.set(name, "pending");
      toInsert.push({
        course_id: courseId,
        author_id: userId,
        name,
        summary,
        evidence_refs: refs,
        prerequisites: (asStringArray(c.prerequisites) ?? []).filter((p) => p !== name).slice(0, 10),
      });
    }
    for (const row of toInsert) {
      const { data, error } = await db().from("concepts").insert(row).select("id, name").single();
      if (error?.code === "23505") {
        const { data: again } = await db().from("concepts").select("id").eq("course_id", courseId).eq("name", row.name as string).single();
        existing.push({ name: row.name as string, concept_id: again?.id });
        continue;
      }
      if (error) throw error;
      saved.push({ name: data.name, concept_id: data.id });
    }
    // 출제 중요도: 개념과 관련 있는 교안 조각의 비율(실제 출제 확률이 아님). 실패해도 개념 저장에는 영향 없음.
    if (saved.length) {
      try {
        const texts = saved.map((s) => {
          const row = toInsert.find((r) => r.name === s.name)!;
          return `${row.name}: ${row.summary}`;
        });
        const vecs = await embed(texts, req);
        await Promise.all(
          saved.map(async (s, i) => {
            const { data } = await db().rpc("concept_importance", { p_course: courseId, p_embedding: vecs[i], p_threshold: IMPORTANCE_MIN });
            if (typeof data === "number") await db().from("concepts").update({ importance: Math.round(data * 100) / 100 }).eq("id", s.concept_id);
          }),
        );
      } catch (e) {
        console.error("importance skipped", e);
      }
    }
    return {
      message: `개념 ${saved.length}개 저장, 이미 있음 ${existing.length}개, 거절 ${rejected.length}개`,
      saved,
      existing,
      rejected,
    };
  },
};

const getQuestionBank: Tool = {
  name: "get_question_bank",
  description:
    "개념별 문항 수(난이도 1~3, 상태별), 이미 있는 문항 본문, 근거 쪽 교안 글을 돌려준다. 문항을 만들기 전에 불러서 중복을 피한다. 난이도 1(기초: 정의·용어)·2(적용: 사례·계산)는 객관식, 3(응용)은 단답형이다.",
  inputSchema: {
    type: "object",
    properties: { course_id: { type: "string" }, concept_id: { type: "string", description: "선택. 없으면 모든 개념" } },
    required: ["course_id"],
  },
  async run(userId, args) {
    const courseId = String(args.course_id ?? "");
    await member(userId, courseId);
    let q = db().from("concepts").select("id, name, summary, evidence_refs, prerequisites").eq("course_id", courseId).order("created_at").limit(60);
    if (args.concept_id) q = q.eq("id", String(args.concept_id));
    const { data: concepts, error } = await q;
    if (error) throw error;
    if (!concepts?.length) throw new ToolError(args.concept_id ? "이 과목에 그 개념이 없어요" : "아직 개념이 없어요. submit_concepts로 먼저 등록해 주세요");
    const ids = concepts.map((c) => c.id);
    const [{ data: statuses }, { data: questions }] = await Promise.all([
      db().from("question_status").select("concept_id, difficulty, status").in("concept_id", ids),
      db().from("questions").select("id, concept_id, difficulty, body").in("concept_id", ids).order("created_at").limit(600),
    ]);
    const withContext = concepts.length <= 10;
    const out = [];
    for (const c of concepts) {
      const counts: Record<string, Record<string, number>> = {};
      for (const d of ["1", "2", "3"]) counts[d] = { first_pass: 0, verified: 0, hidden: 0 };
      for (const s of statuses ?? []) if (s.concept_id === c.id) counts[String(s.difficulty)][s.status as string]++;
      out.push({
        concept_id: c.id,
        name: c.name,
        summary: c.summary,
        prerequisites: c.prerequisites,
        evidence_refs: c.evidence_refs,
        counts,
        questions: (questions ?? []).filter((x) => x.concept_id === c.id).slice(0, 20).map((x) => ({ id: x.id, difficulty: x.difficulty, body: x.body })),
        context: withContext
          ? (await chunksForRefs(courseId, c.evidence_refs as string[], 4)).map((k) => ({ ref: ref(k.material_no, k.page), text: clip(k.content, 1500) }))
          : undefined,
      });
    }
    return { concepts: out };
  },
};

type QIn = Args & { checklist?: Args };

const submitQuestions: Tool = {
  name: "submit_questions",
  description:
    "문항을 1차 검수한 뒤 제출한다. 제출 전에 문항마다 체크리스트 4항목을 직접 판정해 checklist에 true/false로, 판단 사유 한 줄을 check_note에 적는다: answer_correct(정답이 맞는가), evidence_match(근거 쪽 교안 내용과 일치하는가), difficulty_fit(난이도가 맞는가), choices_clear(선택지가 중복·모호하지 않은가). 하나라도 false면 저장하지 않는다. 난이도 1·2는 qtype 'choice'(choices 3~5개, 정답은 그중 하나와 글자가 같아야 함), 3은 qtype 'short'(단답형, accepted_answers에 정답으로 인정할 표현 1~5개). 한 번에 20문항까지.",
  inputSchema: {
    type: "object",
    properties: {
      course_id: { type: "string" },
      questions: {
        type: "array",
        maxItems: 20,
        items: {
          type: "object",
          properties: {
            concept_id: { type: "string" },
            difficulty: { type: "integer", enum: [1, 2, 3] },
            qtype: { type: "string", enum: ["choice", "short"] },
            body: { type: "string" },
            choices: { type: "array", items: { type: "string" } },
            answer: { type: "string" },
            accepted_answers: { type: "array", items: { type: "string" } },
            explanation: { type: "string" },
            evidence_refs: { type: "array", items: { type: "string" } },
            checklist: {
              type: "object",
              properties: {
                answer_correct: { type: "boolean" },
                evidence_match: { type: "boolean" },
                difficulty_fit: { type: "boolean" },
                choices_clear: { type: "boolean" },
              },
              required: ["answer_correct", "evidence_match", "difficulty_fit", "choices_clear"],
            },
            check_note: { type: "string" },
          },
          required: ["concept_id", "difficulty", "qtype", "body", "answer", "explanation", "evidence_refs", "checklist", "check_note"],
        },
      },
    },
    required: ["course_id", "questions"],
  },
  async run(userId, args, req) {
    const courseId = String(args.course_id ?? "");
    await member(userId, courseId);
    const list = Array.isArray(args.questions) ? (args.questions as QIn[]) : [];
    if (!list.length) throw new ToolError("questions가 비어 있어요");
    if (list.length > 20) throw new ToolError("문항은 한 번에 20개까지 보낼 수 있어요");
    const { data: concepts, error } = await db().from("concepts").select("id").eq("course_id", courseId);
    if (error) throw error;
    const conceptIds = new Set((concepts ?? []).map((c) => c.id as string));
    const rejected: { index: number; reason: string }[] = [];
    type Valid = { index: number; row: Record<string, unknown>; refs: string[]; text: string; note: string; checklist: Args };
    const valid: Valid[] = [];

    list.forEach((q, index) => {
      const reject = (reason: string) => rejected.push({ index, reason });
      const missing = ["concept_id", "difficulty", "qtype", "body", "answer", "explanation"].filter((k) => q[k] === undefined || String(q[k]).trim() === "");
      const names: Record<string, string> = { concept_id: "개념", difficulty: "난이도", qtype: "유형", body: "본문", answer: "정답", explanation: "해설" };
      if (missing.length) return reject(`누락: ${missing.map((k) => names[k]).join(", ")}`);
      const cl = (q.checklist ?? {}) as Args;
      const failed = Object.keys(CHECK_NAMES).filter((k) => cl[k] !== true);
      if (failed.length) return reject(`1차 검수 미통과: ${failed.map((k) => CHECK_NAMES[k]).join(", ")}`);
      const note = String(q.check_note ?? "").trim();
      if (!note) return reject("누락: 1차 검수 사유(check_note)");
      const conceptId = String(q.concept_id);
      if (!conceptIds.has(conceptId)) return reject("이 과목에 없는 개념이에요(concept_id 확인)");
      const difficulty = Number(q.difficulty);
      if (![1, 2, 3].includes(difficulty)) return reject("난이도는 1~3이어야 해요");
      const qtype = String(q.qtype);
      if (difficulty === 3 && qtype !== "short") return reject("난이도 3은 단답형(short)이어야 해요");
      if (difficulty < 3 && qtype !== "choice") return reject("난이도 1·2는 객관식(choice)이어야 해요");
      const body = String(q.body).trim();
      if (body.length < 5 || body.length > 1000) return reject("본문은 5~1000자여야 해요");
      const answer = String(q.answer).trim();
      const refs = asStringArray(q.evidence_refs) ?? [];
      if (!refs.length) return reject("누락: 근거 위치");
      const badRef = refs.find((r) => !parseRef(r));
      if (badRef) return reject(`근거 위치 형식이 틀렸어요: ${badRef} (예 1:3)`);
      let choices: string[] | null = null;
      let accepted: string[] = [];
      if (qtype === "choice") {
        choices = asStringArray(q.choices) ?? [];
        const norms = choices.map(normalizeText);
        if (new Set(norms).size !== norms.length) return reject("선택지가 중복돼요");
        const correct = choices.filter((c) => c === answer).length;
        if (correct !== 1) return reject("객관식 정답이 선택지 중 정확히 1개와 같아야 해요");
        if (choices.length < 3 || choices.length > 5) return reject("오답은 2~4개여야 해요(선택지 3~5개)");
      } else {
        accepted = [...new Set([answer, ...(asStringArray(q.accepted_answers) ?? [])])].slice(0, 6);
        if (!(asStringArray(q.accepted_answers) ?? []).length) return reject("누락: 허용 답안(accepted_answers)");
      }
      const suggestion = Number(q.difficulty);
      valid.push({
        index,
        refs,
        note: note.slice(0, 300),
        checklist: cl,
        text: `${body}\n정답: ${answer}`,
        row: {
          course_id: courseId,
          concept_id: conceptId,
          author_id: userId,
          difficulty: suggestion,
          qtype,
          body,
          body_norm: normalizeText(body),
          choices,
          answer,
          accepted_answers: accepted,
          explanation: String(q.explanation).trim(),
          evidence_refs: refs,
          check_note: note.slice(0, 300),
        },
      });
    });

    // 근거 위치가 교안에 있는지, 같은 개념에 본문이 같은 문항이 있는지
    const okRefs = await existingRefs(courseId, valid.flatMap((v) => v.refs));
    const { data: dupRows, error: e2 } = await db()
      .from("questions")
      .select("id, concept_id, body_norm")
      .in("concept_id", [...new Set(valid.map((v) => v.row.concept_id as string))].concat(["00000000-0000-0000-0000-000000000000"]))
      .in("body_norm", valid.map((v) => v.row.body_norm as string).concat(["-"]));
    if (e2) throw e2;
    const seen = new Map((dupRows ?? []).map((d) => [`${d.concept_id}|${d.body_norm}`, d.id as string]));
    const checked: Valid[] = [];
    for (const v of valid) {
      const missing = v.refs.find((r) => !okRefs.has(r));
      if (missing) { rejected.push({ index: v.index, reason: `근거 없음: 교안에 ${missing} 쪽이 없어요` }); continue; }
      const key = `${v.row.concept_id}|${v.row.body_norm}`;
      if (seen.has(key)) { rejected.push({ index: v.index, reason: `중복: 문항 #${seen.get(key)!.slice(0, 8)}와 같아요` }); continue; }
      seen.set(key, "이번 제출의 다른 문항");
      checked.push(v);
    }

    // 근거 쪽 관련성(임베딩). 확인하지 못하면 아무것도 저장하지 않는다.
    const passed: { index: number; question_id: string }[] = [];
    if (checked.length) {
      let vecs: number[][];
      try {
        vecs = await embed(checked.map((v) => v.text), req);
      } catch (e) {
        if (e instanceof EmbedError) throw new ToolError("근거를 확인하지 못했어요. 잠시 후 다시 보내 주세요(저장된 문항 없음)");
        throw e;
      }
      const evidence = await chunksForRefs(courseId, checked.flatMap((v) => v.refs), 200, true);
      for (let i = 0; i < checked.length; i++) {
        const v = checked[i];
        const mine = evidence.filter((c) => v.refs.includes(ref(c.material_no, c.page)));
        const sims = mine.map((c) => parseVector(c.embedding)).filter((x): x is number[] => !!x).map((x) => cosine(vecs[i], x));
        if (!sims.length) { rejected.push({ index: v.index, reason: "근거 쪽이 아직 분석되지 않았어요. 교안 분석이 끝난 뒤 다시 보내 주세요" }); continue; }
        const score = Math.max(...sims);
        if (score < EVIDENCE_MIN) { rejected.push({ index: v.index, reason: `근거 불일치(근거 쪽과의 유사도 ${score.toFixed(2)})` }); continue; }
        const { data, error } = await db().from("questions").insert({ ...v.row, evidence_score: Math.round(score * 1000) / 1000 }).select("id").single();
        if (error?.code === "23505") { rejected.push({ index: v.index, reason: "중복: 같은 본문의 문항이 이미 있어요" }); continue; }
        if (error) throw error;
        const { error: e3 } = await db().from("review_log").insert({
          question_id: data.id,
          reviewer_id: userId,
          stage: 1,
          verdict: "pass",
          checklist: v.checklist,
          reason: v.note,
        });
        if (e3) throw e3;
        passed.push({ index: v.index, question_id: data.id });
      }
    }
    rejected.sort((a, b) => a.index - b.index);
    return {
      message: `1차 통과 ${passed.length}건${rejected.length ? `, 반려 ${rejected.length}건` : ""}. 1차 통과 문항은 지금 나에게만 출제되고, 같은 과목 다른 학생 2명이 통과시키면 모두에게 공개돼요.`,
      passed,
      rejected,
    };
  },
};

async function conceptsInUnit(courseId: string, unit: number): Promise<string[]> {
  const { data, error } = await db().from("concepts").select("id, name, prerequisites, importance, created_at").eq("course_id", courseId);
  if (error) throw error;
  const ordered = orderStages(
    (data ?? []).map((c) => ({ id: c.id, name: c.name, prerequisites: c.prerequisites, importance: c.importance, createdAt: c.created_at }) as ConceptNode),
  );
  return ordered.filter((_, i) => unitOf(i) === unit).map((c) => c.id);
}

const getReviewBatch: Tool = {
  name: "get_review_batch",
  description:
    "같은 과목의 다른 학생이 만든 '1차 통과' 문항 중 내가 아직 검수하지 않은 것을 근거 교안 글과 함께 돌려준다. 문항마다 정답이 맞는지, 근거와 일치하는지, 난이도가 맞는지, 선택지가 명확한지 판정해 submit_reviews로 보낸다. unit을 주면 그 유닛(스테이지 5개)의 문항만 준다.",
  inputSchema: {
    type: "object",
    properties: {
      course_id: { type: "string" },
      unit: { type: "integer", minimum: 1 },
      limit: { type: "integer", minimum: 1, maximum: 20, description: "기본 10" },
    },
    required: ["course_id"],
  },
  async run(userId, args) {
    const courseId = String(args.course_id ?? "");
    await member(userId, courseId);
    const unit = Number(args.unit) || 0;
    const ids = await reviewableQuestionIds(userId, courseId, unit ? await conceptsInUnit(courseId, unit) : undefined);
    const limit = Math.min(20, Math.max(1, Number(args.limit) || 10));
    if (!ids.length) return { questions: [], message: "지금 검수할 문항이 없어요" };
    const { data, error } = await db()
      .from("questions")
      .select("id, difficulty, qtype, body, choices, answer, accepted_answers, explanation, evidence_refs, concepts(name)")
      .in("id", ids.slice(0, limit));
    if (error) throw error;
    const out = [];
    for (const q of data ?? []) {
      out.push({
        question_id: q.id,
        concept: (q.concepts as unknown as { name: string }).name,
        difficulty: q.difficulty,
        qtype: q.qtype,
        body: q.body,
        choices: q.choices,
        answer: q.answer,
        accepted_answers: q.accepted_answers,
        explanation: q.explanation,
        evidence: (await chunksForRefs(courseId, q.evidence_refs as string[], 2)).map((c) => ({ ref: ref(c.material_no, c.page), text: clip(c.content, 1200) })),
      });
    }
    return { questions: out, remaining: Math.max(0, ids.length - out.length) };
  },
};

const submitReviews: Tool = {
  name: "submit_reviews",
  description:
    "get_review_batch로 받은 문항의 2차 검수 결과를 보낸다. verdict는 pass(통과)·revise(수정 제안)·fail(불합격), reason은 한 줄 사유. 내가 통과시킨 문항은 내 스테이지 출제 대상에 더해진다. 서로 다른 학생 2명이 통과시키면 검증 완료, 불합격 2건이면 숨김이 된다. 자기 문항은 검수할 수 없다.",
  inputSchema: {
    type: "object",
    properties: {
      course_id: { type: "string" },
      reviews: {
        type: "array",
        maxItems: 30,
        items: {
          type: "object",
          properties: {
            question_id: { type: "string" },
            verdict: { type: "string", enum: ["pass", "revise", "fail"] },
            reason: { type: "string" },
            suggested_difficulty: { type: "integer", enum: [1, 2, 3] },
          },
          required: ["question_id", "verdict", "reason"],
        },
      },
    },
    required: ["course_id", "reviews"],
  },
  async run(userId, args) {
    const courseId = String(args.course_id ?? "");
    await member(userId, courseId);
    const list = Array.isArray(args.reviews) ? (args.reviews as Args[]) : [];
    if (!list.length) throw new ToolError("reviews가 비어 있어요");
    if (list.length > 30) throw new ToolError("검수는 한 번에 30개까지 보낼 수 있어요");
    const ids = list.map((r) => String(r.question_id ?? "")).filter((id) => /^[0-9a-f-]{36}$/i.test(id));
    const { data: qs, error } = await db().from("questions").select("id, course_id, author_id").in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
    if (error) throw error;
    const byId = new Map((qs ?? []).map((q) => [q.id as string, q]));
    const saved: string[] = [];
    const rejected: { question_id: string; reason: string }[] = [];
    for (const r of list) {
      const id = String(r.question_id ?? "");
      const q = byId.get(id);
      const verdict = String(r.verdict ?? "");
      const reason = String(r.reason ?? "").trim();
      if (!q || q.course_id !== courseId) { rejected.push({ question_id: id, reason: "이 과목의 문항이 아니에요" }); continue; }
      if (q.author_id === userId) { rejected.push({ question_id: id, reason: "내가 만든 문항은 검수할 수 없어요" }); continue; }
      if (!["pass", "revise", "fail"].includes(verdict)) { rejected.push({ question_id: id, reason: "verdict는 pass·revise·fail 중 하나예요" }); continue; }
      if (!reason) { rejected.push({ question_id: id, reason: "누락: 사유" }); continue; }
      const sd = Number(r.suggested_difficulty);
      const { error: e2 } = await db().from("review_log").insert({
        question_id: id,
        reviewer_id: userId,
        stage: 2,
        verdict,
        reason: reason.slice(0, 300),
        suggested_difficulty: [1, 2, 3].includes(sd) ? sd : null,
      });
      if (e2?.code === "23505") { rejected.push({ question_id: id, reason: "이미 검수했어요" }); continue; }
      if (e2) throw e2;
      saved.push(id);
    }
    const statuses = await statusOf(saved);
    const label = { first_pass: "1차 통과", verified: "검증 완료", hidden: "숨김" };
    return {
      message: `검수 ${saved.length}건 저장${rejected.length ? `, 거절 ${rejected.length}건` : ""}. 통과시킨 문항은 내 스테이지 출제 대상에 더해져요.`,
      status_changes: saved.map((id) => ({ question_id: id, status: label[statuses.get(id) ?? "first_pass"] })),
      rejected,
    };
  },
};

export const TOOLS: Tool[] = [listCourses, getCourseContext, submitConcepts, getQuestionBank, submitQuestions, getReviewBatch, submitReviews];
