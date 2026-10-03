// FR-01 교안 색인: 청크마다 임베딩을 만들어 저장한다(쓰기: 교안 모듈).
// - 청크는 1,000행씩 나눠 끝까지 읽는다(Supabase API 기본 행 제한 1,000).
// - 읽은 개수가 업로드 때 저장한 개수와 같고 모든 저장이 성공할 때만 ready로 바꾼다.
// - 중간 어디서 실패해도 failed로 남겨 "다시 시도"로 처음부터 다시 한다. ready가 아니면 언제든 다시 시도할 수 있다.
import { db } from "@/lib/supabase-admin";
import { requireUser } from "@/lib/auth";
import { requireMember } from "@/lib/access";
import { handle, ok, HttpError } from "@/lib/http";
import { embed } from "@/lib/embed";

export const maxDuration = 120;
const PAGE = 1000;

type ChunkRow = { id: number; material_id: string; course_id: string; material_no: number; page: number; seq: number; content: string };

async function readAllChunks(materialId: string): Promise<ChunkRow[]> {
  const rows: ChunkRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db()
      .from("chunks")
      .select("id, material_id, course_id, material_no, page, seq, content")
      .eq("material_id", materialId)
      .order("seq")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...((data ?? []) as ChunkRow[]));
    if (!data || data.length < PAGE) return rows;
  }
}

async function setStatus(id: string, fields: Record<string, unknown>) {
  const { error } = await db().from("materials").update(fields).eq("id", id);
  if (error) throw error;
}

export const POST = handle(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const user = await requireUser(req);
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(404, "not_found", "교안을 찾을 수 없어요");
  const { data: material, error } = await db()
    .from("materials")
    .select("id, course_id, status, chunk_count")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!material) throw new HttpError(404, "not_found", "교안을 찾을 수 없어요");
  await requireMember(user.id, material.course_id);
  if (material.status === "ready") return ok({ material: { id, status: "ready", chunkCount: material.chunk_count } });

  try {
    await setStatus(id, { status: "indexing", error: null });
    const chunks = await readAllChunks(id);
    if (chunks.length !== material.chunk_count) {
      throw new Error(`청크 개수 불일치: 저장 ${material.chunk_count}, 읽음 ${chunks.length}`);
    }
    const vectors = await embed(chunks.map((c) => c.content), req);
    if (vectors.length !== chunks.length) throw new Error("임베딩 개수 불일치");
    const rows = chunks.map((c, i) => ({ ...c, embedding: vectors[i] }));
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await db().from("chunks").upsert(rows.slice(i, i + 200), { onConflict: "id" });
      if (error) throw error;
    }
    // 모든 청크에 임베딩이 들어갔는지 확인한 뒤 완료로 바꾼다
    const { count, error: e2 } = await db()
      .from("chunks")
      .select("id", { count: "exact", head: true })
      .eq("material_id", id)
      .not("embedding", "is", null);
    if (e2) throw e2;
    if (count !== chunks.length) throw new Error(`임베딩 저장 불일치: ${count}/${chunks.length}`);
    await setStatus(id, { status: "ready", embedded: true, error: null });
    return ok({ material: { id, status: "ready", chunkCount: chunks.length } });
  } catch (e) {
    console.error("index failed", id, e);
    // 실패 표시도 저장에 실패할 수 있다. 그래도 ready가 아니므로 화면의 "다시 시도"로 복구된다.
    await db().from("materials").update({ status: "failed", error: "분석 실패" }).eq("id", id);
    throw new HttpError(502, "embed_failed", "분석에 실패했어요. 다시 시도해 주세요");
  }
});
