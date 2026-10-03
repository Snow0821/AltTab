"use client";
// 교안 업로드 (FR-01, 담당: 이제민). PDF는 브라우저에서 쪽별 글자만 뽑아 보내고 원본은 올리지 않는다.
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api-client";
import { fitsUpload } from "@/lib/upload";
import { LIMITS } from "@/lib/config";

type Material = { id: string; no: number; filename: string; status: string; chunkCount: number; error: string | null };

const MIN_BYTES = LIMITS.materialMinBytes;
const MAX_BYTES = LIMITS.materialMaxBytes;

async function sha256(buf: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function extractPages(buf: ArrayBuffer) {
  const { getDocumentProxy, extractText } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const { text } = await extractText(pdf, { mergePages: false });
  // 쪽 글자는 자르지 않는다. 너무 크면 업로드 전에 거절한다.
  return (text as string[]).map((t, i) => ({ page: i + 1, text: t }));
}

function statusLabel(m: Material) {
  if (m.status === "ready") return <span className="msg-ok">분석 준비 완료(청크 {m.chunkCount}개)</span>;
  if (m.status === "failed") return <span className="msg-error">분석에 실패했어요</span>;
  if (m.status === "indexing") return <span>분석 중…</span>;
  return <span>업로드 완료</span>;
}

export default function MaterialsPanel({ courseId }: { courseId: string }) {
  const [materials, setMaterials] = useState<Material[]>([]);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const { materials } = await api<{ materials: Material[] }>(`/api/courses/${courseId}/materials`);
      setMaterials(materials);
    } catch (e) {
      setMessage({ kind: "error", text: e instanceof ApiError ? e.message : "교안 목록을 불러오지 못했어요" });
    }
  }, [courseId]);

  useEffect(() => {
    load();
  }, [load]);

  async function index(id: string) {
    setMaterials((ms) => ms.map((m) => (m.id === id ? { ...m, status: "indexing" } : m)));
    try {
      await api(`/api/materials/${id}/index`, {});
      setMessage({ kind: "ok", text: "분석이 끝났어요. 이제 내 AI에게 개념과 문제를 만들어 달라고 해 보세요." });
    } catch (e) {
      setMessage({ kind: "error", text: e instanceof ApiError ? e.message : "분석에 실패했어요. 다시 시도해 주세요" });
    }
    await load();
  }

  async function onFile(file: File) {
    setMessage(null);
    if (!/\.pdf$/i.test(file.name) || (file.type && file.type !== "application/pdf")) {
      return setMessage({ kind: "error", text: "PDF 파일만 올릴 수 있어요" });
    }
    if (file.size < MIN_BYTES) return setMessage({ kind: "error", text: "1KB보다 작은 파일은 올릴 수 없어요" });
    if (file.size > MAX_BYTES) return setMessage({ kind: "error", text: "50MB보다 큰 파일은 올릴 수 없어요" });
    if (materials.length >= LIMITS.materialsPerCourse) return setMessage({ kind: "error", text: "교안은 과목마다 20개까지 올릴 수 있어요" });
    setBusy(true);
    try {
      const buf = await file.arrayBuffer();
      const fileHash = await sha256(buf);
      let pages: { page: number; text: string }[];
      try {
        pages = await extractPages(buf.slice(0));
      } catch {
        throw new Error("PDF를 열 수 없어요. 암호가 걸렸거나 손상된 파일인지 확인해 주세요");
      }
      if (!pages.some((p) => p.text.trim())) throw new Error("텍스트를 추출할 수 없습니다");
      const body = { filename: file.name, fileHash, sizeBytes: file.size, pages };
      if (!fitsUpload(body)) {
        throw new Error("교안의 글자가 너무 많아 한 번에 올릴 수 없어요(약 4MB 초과). PDF를 나눠서 올려 주세요");
      }
      const { material } = await api<{ material: Material }>(`/api/courses/${courseId}/materials`, body);
      setMaterials((ms) => [...ms, material]);
      setMessage({ kind: "ok", text: `${file.name} 업로드 완료. 분석을 시작해요.` });
      await index(material.id);
    } catch (e) {
      setMessage({ kind: "error", text: e instanceof Error ? e.message : "업로드하지 못했어요" });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="card space-y-3">
      <div className="space-y-1">
        <p className="font-semibold">교안 PDF 올리기</p>
        <p className="text-sm text-[var(--muted)]">
          1KB~50MB PDF, 과목마다 20개까지. 글자만 뽑아 분석하고 PDF 파일은 저장하지 않아요. 스캔한 그림 PDF는 글자를 읽지 못해요.
        </p>
      </div>
      <input
        ref={input}
        type="file"
        accept="application/pdf,.pdf"
        disabled={busy}
        onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
        className="input"
      />
      {busy && <p className="text-sm">글자를 읽고 올리는 중…</p>}
      {message && <p className={message.kind === "ok" ? "msg-ok" : "msg-error"}>{message.text}</p>}
      {materials.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">아직 올린 교안이 없어요.</p>
      ) : (
        <ul className="divide-y divide-[var(--line)]">
          {materials.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <span>
                교안 {m.no} · {m.filename}
              </span>
              <span className="flex items-center gap-2">
                {statusLabel(m)}
                {m.status !== "ready" && (
                  <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => index(m.id)}>
                    다시 시도
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
