"use client";
// 결제 화면 (FR-06, 담당: 박재현). 실제 돈이 나가지 않는 테스트 결제다.
import { use, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api-client";

import { PRODUCTS as PRODUCT_CONFIG } from "@/lib/config";

const PRODUCTS = (Object.keys(PRODUCT_CONFIG) as (keyof typeof PRODUCT_CONFIG)[]).map((id) => ({ id, ...PRODUCT_CONFIG[id] }));

export default function PayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [product, setProduct] = useState<string>("");
  const [card, setCard] = useState<"ok" | "fail">("ok");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [has, setHas] = useState(false);
  const [key, setKey] = useState("");

  useEffect(() => {
    setKey(crypto.randomUUID());
    api<{ access: { has: boolean } }>(`/api/courses/${id}`)
      .then((r) => setHas(r.access.has))
      .catch(() => {});
  }, [id]);

  async function pay() {
    if (!product || busy) return;
    setBusy(true);
    setResult(null);
    try {
      await api("/api/payments", { product, courseId: id, card, idempotencyKey: key });
      setHas(true);
      setResult({ kind: "ok", text: "결제됐어요. 이 과목에 '이용 중'이 표시되고 6번째 스테이지부터 풀 수 있어요." });
    } catch (e) {
      setResult({ kind: "error", text: e instanceof ApiError ? e.message : "결제하지 못했어요. 다시 시도해 주세요" });
      setKey(crypto.randomUUID()); // 실패한 요청과 구분되는 새 결제 요청
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mx-auto max-w-md space-y-4">
      <a href={`/courses/${id}`} className="text-sm text-[var(--muted)]">
        ← 과목으로
      </a>
      <h1 className="text-2xl font-bold">이용권 결제</h1>
      <p className="rounded-lg bg-[var(--line)] p-3 text-sm">실제 돈이 나가지 않는 테스트 결제예요. 결제사와 연결하지 않았어요.</p>
      {has && <p className="card msg-ok">이미 이용권이 있어요. 지금 바로 모든 스테이지를 풀 수 있어요.</p>}
      <div className="space-y-2" role="radiogroup" aria-label="상품">
        {PRODUCTS.map((p) => (
          <button
            key={p.id}
            role="radio"
            aria-checked={product === p.id}
            onClick={() => setProduct(p.id)}
            className={`card block w-full text-left ${product === p.id ? "border-[var(--accent)] ring-2 ring-[var(--accent)]" : ""}`}
          >
            <span className="font-semibold">{p.title}</span>
            <span className="block text-sm text-[var(--muted)]">{p.detail}</span>
          </button>
        ))}
      </div>
      <label className="block space-y-1">
        <span className="text-sm">테스트 카드</span>
        <select className="input" value={card} onChange={(e) => setCard(e.target.value as "ok" | "fail")}>
          <option value="ok">정상 테스트 카드</option>
          <option value="fail">실패 시험 카드(승인 거절)</option>
        </select>
      </label>
      <button className="btn w-full" disabled={!product || busy} onClick={pay}>
        {busy ? "결제 중…" : product ? "테스트 결제하기" : "상품을 먼저 골라 주세요"}
      </button>
      {result && <p className={`card ${result.kind === "ok" ? "msg-ok" : "msg-error"}`}>{result.text}</p>}
    </section>
  );
}
