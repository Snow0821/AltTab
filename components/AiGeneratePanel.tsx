"use client";
// 웹에서 AI로 첫 유닛 문제 만들기 (FR-12). 생성 중에는 버튼을 막아 같은 요청이 두 번 가지 않게 한다.
import { useState } from "react";
import { api, ApiError } from "@/lib/api-client";

type Result = { message: string; model: string; provider: "school" | "gateway" };

export default function AiGeneratePanel({ courseId, onDone }: { courseId: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");

  async function run() {
    if (busy) return;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const r = await api<Result>(`/api/courses/${courseId}/generate`, {});
      setResult(r);
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "문제를 만들지 못했어요. 잠시 후 다시 시도해 주세요");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card space-y-2">
      <p className="font-semibold">AI로 첫 유닛 문제 만들기</p>
      <p className="text-sm text-[var(--muted)]">
        올린 교안을 AI가 읽고 쉬운 개념 5개와 개념마다 객관식 5문제를 만들어요. 만든 문제는 교안 근거와 중복을 확인한 뒤 저장돼요. 과목마다 하루 3번까지예요.
      </p>
      <button className="btn w-full" disabled={busy} onClick={run}>
        {busy ? "문제를 만드는 중이에요(1~2분)…" : "AI로 첫 유닛 문제 만들기"}
      </button>
      {result && (
        <p className="msg-ok text-sm">
          {result.message} · 사용한 모델: {result.model}
          {result.provider === "gateway" ? "(대체 모델)" : "(학교 AI)"}
        </p>
      )}
      {error && <p className="msg-error text-sm">{error}</p>}
    </div>
  );
}
