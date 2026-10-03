// FR-01 교안 색인: 청크마다 임베딩을 만들어 저장한다. 실패하면 failed로 두고 "다시 시도"로 다시 부른다.
import { db } from "@/lib/supabase-admin";
import { requireUser } from "@/lib/auth";
import { requireMember } from "@/lib/access";
import { handle, ok, HttpError } from "@/lib/http";
import { embed, EmbedError } from "@/lib/embed";

export const maxDuration = 120;

export const POST = handle(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const user = await requireUser(req);
  const { data: material, error } = await db()
    .from("materials")
    .select("id, course_id, status, chunk_count")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!material) throw new HttpError(404, "not_found", "교안을 찾을 수 없어요");
  await requireMember(user.id, material.course_id);
  if (material.status === "ready") return ok({ material: { id, status: "ready", chunkCount: material.chunk_count } });

  await db().from("materials").update({ status: "indexing", error: null }).eq("id", id);
  const { data: chunks, error: e2 } = await db()
    .from("chunks")
    .select("id, material_id, course_id, material_no, page, seq, content")
    .eq("material_id", id)
    .order("seq");
  if (e2) throw e2;
  try {
    const vectors = await embed((chunks ?? []).map((c) => c.content), req);
    const rows = (chunks ?? []).map((c, i) => ({ ...c, embedding: vectors[i] }));
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await db().from("chunks").upsert(rows.slice(i, i + 200), { onConflict: "id" });
      if (error) throw error;
    }
  } catch (e) {
    console.error("index failed", e);
    const reason = e instanceof EmbedError ? "임베딩 서버 응답 실패" : "저장 실패";
    await db().from("materials").update({ status: "failed", error: reason }).eq("id", id);
    throw new HttpError(502, "embed_failed", "분석에 실패했어요. 다시 시도해 주세요");
  }
  await db()
    .from("materials")
    .update({ status: "ready", embedded: true, chunk_count: chunks?.length ?? 0 })
    .eq("id", id);
  return ok({ material: { id, status: "ready", chunkCount: chunks?.length ?? 0 } });
});
