// FR-01 교안 목록·업로드 등록 (쓰기: 교안 모듈)
// 브라우저가 PDF에서 쪽별 글자를 뽑아 보낸다. PDF 원본은 받지도 저장하지도 않는다.
import { db } from "@/lib/supabase-admin";
import { requireUser } from "@/lib/auth";
import { requireMember } from "@/lib/access";
import { handle, ok, readJson, HttpError } from "@/lib/http";
import { chunkPages } from "@/lib/chunk";
import { str, int, arrayOf, asObject, InvalidInput } from "@/lib/validate";

const MAX_FILES = 20;
const MIN_BYTES = 1024;
const MAX_BYTES = 50 * 1024 * 1024;

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const user = await requireUser(req);
  await requireMember(user.id, id);
  const { data, error } = await db()
    .from("materials")
    .select("id, no, filename, status, chunk_count, error, created_at")
    .eq("course_id", id)
    .order("no");
  if (error) throw error;
  return ok({
    materials: (data ?? []).map((m) => ({
      id: m.id,
      no: m.no,
      filename: m.filename,
      status: m.status,
      chunkCount: m.chunk_count,
      error: m.error,
    })),
  });
});

export const POST = handle(async (req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const user = await requireUser(req);
  await requireMember(user.id, id);
  const body = await readJson(req);
  const filename = str(body, "filename", { label: "파일 이름", max: 200 });
  if (!/\.pdf$/i.test(filename)) throw new HttpError(400, "not_pdf", "PDF 파일만 올릴 수 있어요");
  const size = int(body, "sizeBytes", { label: "파일 크기" })!;
  if (size < MIN_BYTES) throw new HttpError(400, "too_small", "1KB보다 작은 파일은 올릴 수 없어요");
  if (size > MAX_BYTES) throw new HttpError(400, "too_large", "50MB보다 큰 파일은 올릴 수 없어요");
  const hash = str(body, "fileHash", { label: "파일 정보", max: 64 });
  if (!/^[0-9a-f]{64}$/.test(hash)) throw new HttpError(400, "invalid", "파일 정보를 읽지 못했어요. 다시 올려 주세요");
  const pages = arrayOf(body, "pages", "쪽 목록", 5000, (v) => {
    const p = asObject(v);
    if (typeof p.text !== "string") throw new InvalidInput("쪽 글자 형식이 올바르지 않아요");
    return { page: int(p, "page", { label: "쪽 번호", min: 1, max: 100_000 })!, text: p.text };
  });
  const chunks = chunkPages(pages);
  if (chunks.length === 0) throw new HttpError(400, "no_text", "텍스트를 추출할 수 없습니다");

  const { data: existing, error: e1 } = await db()
    .from("materials")
    .select("id, no, file_hash")
    .eq("course_id", id);
  if (e1) throw e1;
  if (existing?.some((m) => m.file_hash === hash)) throw new HttpError(409, "duplicate", "이미 분석된 교안입니다");
  if ((existing?.length ?? 0) >= MAX_FILES) throw new HttpError(422, "limit", "교안은 과목마다 20개까지 올릴 수 있어요");
  const no = Math.max(0, ...(existing ?? []).map((m) => m.no as number)) + 1;

  const { data: material, error: e2 } = await db()
    .from("materials")
    .insert({
      course_id: id,
      no,
      uploader_id: user.id,
      filename,
      file_hash: hash,
      size_bytes: size,
      page_count: Math.max(1, ...pages.map((p) => p.page)),
      status: "uploaded",
      chunk_count: chunks.length,
    })
    .select("id, no, filename, status, chunk_count")
    .single();
  if (e2?.code === "23505") throw new HttpError(409, "duplicate", "이미 분석된 교안입니다");
  if (e2) throw e2;

  const rows = chunks.map((c) => ({ material_id: material.id, course_id: id, material_no: no, page: c.page, seq: c.seq, content: c.content }));
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db().from("chunks").insert(rows.slice(i, i + 500));
    if (error) {
      await db().from("materials").delete().eq("id", material.id);
      throw error;
    }
  }
  return ok(
    { material: { id: material.id, no: material.no, filename: material.filename, status: material.status, chunkCount: material.chunk_count } },
    201,
  );
});
