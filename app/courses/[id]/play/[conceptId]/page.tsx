"use client";
// 스테이지 플레이·결과 (FR-05, 역할 D). 5문제를 한 문제씩, 틀린 문제는 끝에 한 번 더(2회차). 클리어 판정은 1회차만.
import { use, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api-client";

type Q = { id: string; qtype: "choice" | "short"; body: string; choices: string[] | null };
type Start = { attemptId: string; conceptName: string; difficulty: number; questions: Q[] };
type Graded = { correct: boolean; correctAnswer: string; acceptedAnswers: string[]; explanation: string };
type Finish = {
  cleared: boolean;
  correctCount: number;
  total: number;
  xp: { correct: number; clear: number; perfect: number; total: number };
  stars: { before: number; after: number };
  mastery: { before: number; after: number };
  unlockedConceptId: string | null;
  alreadyFinished?: boolean;
};
type Turn = { q: Q; round: 1 | 2 };

const REASONS = [
  { id: "wrong_answer", label: "정답이 틀렸어요" },
  { id: "ambiguous", label: "문제가 모호해요" },
  { id: "out_of_scope", label: "교안 범위 밖이에요" },
];

export default function PlayPage({ params }: { params: Promise<{ id: string; conceptId: string }> }) {
  const { id, conceptId } = use(params);
  const [start, setStart] = useState<Start | null>(null);
  const [blocked, setBlocked] = useState<{ text: string; pay?: boolean } | null>(null);
  const [queue, setQueue] = useState<Turn[]>([]);
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState("");
  const [graded, setGraded] = useState<Graded | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Finish | null>(null);
  const [reportMsg, setReportMsg] = useState("");

  useEffect(() => {
    api<Start>("/api/stages/start", { courseId: id, conceptId })
      .then((s) => {
        setStart(s);
        setQueue(s.questions.map((q) => ({ q, round: 1 as const })));
      })
      .catch((e) => {
        if (e instanceof ApiError) setBlocked({ text: e.message, pay: e.code === "payment_required" });
        else setBlocked({ text: "스테이지를 시작하지 못했어요. 다시 시도해 주세요" });
      });
  }, [id, conceptId]);

  const turn = queue[index];
  const firstRoundCount = start?.questions.length ?? 5;

  async function submit() {
    if (!turn || !start || busy) return;
    setBusy(true);
    setError("");
    try {
      const g = await api<Graded>("/api/stages/answer", { attemptId: start.attemptId, questionId: turn.q.id, answer, round: turn.round });
      setGraded(g);
      if (!g.correct && turn.round === 1) setQueue((qs) => [...qs, { q: turn.q, round: 2 }]);
    } catch (e) {
      setError(e instanceof ApiError && e.code !== "server_error" ? e.message : "채점하지 못했어요. 다시 제출해 주세요");
    } finally {
      setBusy(false);
    }
  }

  async function next() {
    setGraded(null);
    setAnswer("");
    setReportMsg("");
    if (index + 1 < queue.length) return setIndex(index + 1);
    setBusy(true);
    try {
      setResult(await api<Finish>("/api/stages/finish", { attemptId: start!.attemptId }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "결과를 저장하지 못했어요. 다시 눌러 주세요");
    } finally {
      setBusy(false);
    }
  }

  async function report(reason: string) {
    try {
      const r = await api<{ hidden: boolean }>(`/api/questions/${turn.q.id}/report`, { reason });
      setReportMsg(r.hidden ? "신고가 3건 쌓여 이 문항은 숨겨졌어요." : "신고했어요. 고마워요.");
    } catch (e) {
      setReportMsg(e instanceof ApiError ? e.message : "신고하지 못했어요");
    }
  }

  const back = (
    <a href={`/courses/${id}`} className="text-sm text-[var(--muted)]">
      ← 스테이지 맵
    </a>
  );

  if (blocked)
    return (
      <section className="mx-auto max-w-md space-y-4">
        {back}
        <div className="card space-y-3">
          <p>{blocked.text}</p>
          {blocked.pay && (
            <a className="btn" href={`/courses/${id}/pay`}>
              이용권 보기
            </a>
          )}
        </div>
      </section>
    );
  if (!start) return <p className="text-[var(--muted)]">문제를 고르는 중…</p>;

  if (result)
    return (
      <section className="mx-auto max-w-md space-y-4">
        {back}
        <div className="card space-y-3 text-center">
          <p className="text-3xl font-bold">{result.cleared ? "클리어!" : "다시 도전"}</p>
          <p>
            {start.conceptName} · 정답 {result.correctCount}/{result.total}
          </p>
          {!result.alreadyFinished && (
            <>
              <ul className="space-y-1 text-sm">
                <li>정답 {result.xp.correct} XP</li>
                {result.xp.clear > 0 && <li>클리어 +{result.xp.clear} XP</li>}
                {result.xp.perfect > 0 && <li>첫 시도 만점 +{result.xp.perfect} XP</li>}
                <li className="font-semibold">합계 {result.xp.total} XP</li>
              </ul>
              <p>
                별 {"★".repeat(result.stars.before) || "없음"} → {"★".repeat(result.stars.after) || "없음"}
              </p>
              <p>
                숙련도 {result.mastery.before.toFixed(2)} → {result.mastery.after.toFixed(2)}
              </p>
            </>
          )}
          {!result.cleared && <p className="text-sm text-[var(--muted)]">5문제 중 4개 이상 맞히면 클리어예요. 불이익은 없어요.</p>}
          <div className="flex flex-wrap justify-center gap-2">
            {result.unlockedConceptId && (
              <a className="btn" href={`/courses/${id}/play/${result.unlockedConceptId}`}>
                다음 스테이지
              </a>
            )}
            <a className="btn btn-ghost" href={`/courses/${id}/play/${conceptId}`}>
              {result.cleared ? "다시 풀기" : "다시 도전"}
            </a>
            <a className="btn btn-ghost" href={`/courses/${id}`}>
              맵으로
            </a>
          </div>
        </div>
      </section>
    );

  return (
    <section className="mx-auto max-w-md space-y-4">
      {back}
      <div className="flex items-center justify-between text-sm">
        <span>
          {start.conceptName} · {"★".repeat(start.difficulty)}
        </span>
        <span>{turn.round === 1 ? `${Math.min(index + 1, firstRoundCount)}/${firstRoundCount}` : "틀린 문제 다시 풀기"}</span>
      </div>
      <div className="h-2 rounded-full bg-[var(--line)]">
        <div className="h-2 rounded-full bg-[var(--accent)]" style={{ width: `${Math.round((index / queue.length) * 100)}%` }} />
      </div>
      <div className="card space-y-4">
        <p className="whitespace-pre-wrap font-semibold">{turn.q.body}</p>
        {turn.q.qtype === "choice" ? (
          <div className="space-y-2">
            {turn.q.choices?.map((c) => (
              <button
                key={c}
                disabled={!!graded}
                onClick={() => setAnswer(c)}
                className={`card block w-full text-left ${answer === c ? "border-[var(--accent)] ring-2 ring-[var(--accent)]" : ""}`}
              >
                {c}
              </button>
            ))}
          </div>
        ) : (
          <input
            className="input"
            placeholder="답을 적어 주세요(단답형)"
            value={answer}
            disabled={!!graded}
            onChange={(e) => setAnswer(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !graded && submit()}
          />
        )}
        {error && <p className="msg-error text-sm">{error}</p>}
        {!graded ? (
          <button className="btn w-full" disabled={busy} onClick={submit}>
            {busy ? "채점 중…" : answer.trim() ? "제출" : "모르겠어요(빈 답 제출)"}
          </button>
        ) : (
          <div className="space-y-2">
            <p className={`text-lg font-bold ${graded.correct ? "msg-ok" : "msg-error"}`}>
              {graded.correct ? (turn.round === 1 ? "정답! +10XP" : "정답!") : "오답"}
            </p>
            <p className="text-sm">정답: {graded.correctAnswer}</p>
            {graded.acceptedAnswers.length > 1 && <p className="text-sm text-[var(--muted)]">정답으로 인정하는 답: {graded.acceptedAnswers.join(", ")}</p>}
            <p className="text-sm">해설: {graded.explanation}</p>
            {!graded.correct && turn.round === 1 && <p className="text-xs text-[var(--muted)]">이 문제는 끝에 한 번 더 나와요.</p>}
            <button className="btn w-full" disabled={busy} onClick={next}>
              {index + 1 < queue.length ? "다음 문제" : busy ? "결과 저장 중…" : "결과 보기"}
            </button>
          </div>
        )}
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-[var(--muted)]">문제 신고</summary>
        <div className="mt-2 flex flex-wrap gap-2">
          {REASONS.map((r) => (
            <button key={r.id} className="btn btn-ghost px-3 py-1 text-xs" onClick={() => report(r.id)}>
              {r.label}
            </button>
          ))}
        </div>
        {reportMsg && <p className="mt-1">{reportMsg}</p>}
      </details>
    </section>
  );
}
