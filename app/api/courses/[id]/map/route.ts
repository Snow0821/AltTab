// FR-04 스테이지 맵 (읽기 전용, 소유: 퀴즈 모듈)
import { requireUser } from "@/lib/auth";
import { requireMember } from "@/lib/access";
import { handle, ok } from "@/lib/http";
import { loadStages, reviewNeededByUnit, totalXp } from "@/lib/quiz";

export const GET = handle(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const user = await requireUser(req);
  await requireMember(user.id, id);
  const { stages, hasAccess } = await loadStages(user.id, id);
  const cleared = stages.filter((s) => s.stars >= 1).length;
  return ok({
    stages,
    hasAccess,
    progress: { cleared, total: stages.length, percent: stages.length ? Math.round((cleared / stages.length) * 100) : 0 },
    xp: await totalXp(user.id, id),
    units: await reviewNeededByUnit(user.id, id, stages),
  });
});
