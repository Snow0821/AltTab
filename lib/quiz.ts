// 스테이지 맵 계산(FR-04, 소유: 퀴즈 모듈). 규칙은 lib/rules.ts, 문항 공개 규칙은 lib/review.ts를 읽는다.
import { db } from "./supabase-admin";
import { hasAccess } from "./entitlement";
import { reviewableQuestionIds } from "./review";
import { orderStages, stageStates, unitOf, type StageState } from "./rules";

export type Stage = {
  conceptId: string;
  name: string;
  order: number;
  unit: number;
  stars: number;
  mastery: number;
  state: StageState;
  needsReview: boolean;
};

export async function loadStages(userId: string, courseId: string) {
  const [{ data: concepts, error }, { data: progress, error: e2 }, access] = await Promise.all([
    db().from("concepts").select("id, name, prerequisites, importance, created_at").eq("course_id", courseId),
    db().from("stage_progress").select("concept_id, stars, mastery, next_review_at").eq("course_id", courseId).eq("user_id", userId),
    hasAccess(userId, courseId),
  ]);
  if (error) throw error;
  if (e2) throw e2;
  const ordered = orderStages(
    (concepts ?? []).map((c) => ({ id: c.id, name: c.name, prerequisites: c.prerequisites ?? [], importance: c.importance, createdAt: c.created_at })),
  );
  const byConcept = new Map((progress ?? []).map((p) => [p.concept_id as string, p]));
  const stars = ordered.map((c) => (byConcept.get(c.id)?.stars as number) ?? 0);
  const states = stageStates(stars, access);
  const now = Date.now();
  const stages: Stage[] = ordered.map((c, i) => {
    const p = byConcept.get(c.id);
    const mastery = (p?.mastery as number) ?? 0;
    const due = p?.next_review_at ? new Date(p.next_review_at as string).getTime() <= now : false;
    return {
      conceptId: c.id,
      name: c.name,
      order: i + 1,
      unit: unitOf(i),
      stars: stars[i],
      mastery,
      state: states[i],
      needsReview: stars[i] >= 1 && (due || mastery < 0.6),
    };
  });
  return { stages, hasAccess: access };
}

export async function reviewNeededByUnit(userId: string, courseId: string, stages: Stage[]) {
  const ids = await reviewableQuestionIds(userId, courseId);
  const counts = new Map<number, number>();
  if (ids.length) {
    const { data, error } = await db().from("questions").select("concept_id").in("id", ids);
    if (error) throw error;
    const unitOfConcept = new Map(stages.map((s) => [s.conceptId, s.unit]));
    for (const q of data ?? []) {
      const u = unitOfConcept.get(q.concept_id as string);
      if (u) counts.set(u, (counts.get(u) ?? 0) + 1);
    }
  }
  const units = [...new Set(stages.map((s) => s.unit))];
  return units.map((unit) => ({ unit, reviewNeeded: counts.get(unit) ?? 0 }));
}

export async function totalXp(userId: string, courseId: string) {
  const { data, error } = await db().from("xp_log").select("amount").eq("user_id", userId).eq("course_id", courseId);
  if (error) throw error;
  return (data ?? []).reduce((s, r) => s + (r.amount as number), 0);
}
