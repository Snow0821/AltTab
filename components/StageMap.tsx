"use client";
// 스테이지 맵 (FR-04, 담당: 박예나 화면 / 장용선 API). 응답 형식은 설계서 8절 GET /api/courses/{id}/map.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api-client";

type Stage = {
  conceptId: string;
  name: string;
  order: number;
  unit: number;
  stars: number;
  state: "cleared" | "open" | "locked" | "paywall";
  needsReview: boolean;
};
type MapData = {
  stages: Stage[];
  hasAccess: boolean;
  progress: { cleared: number; total: number; percent: number };
  xp: number;
  units: { unit: number; reviewNeeded: number }[];
};

const starText = (n: number) => "★".repeat(n) + "☆".repeat(3 - n);

export default function StageMap({ courseId, courseTitle }: { courseId: string; courseTitle: string }) {
  const router = useRouter();
  const [data, setData] = useState<MapData | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<{ text: string; pay?: boolean } | null>(null);

  async function load() {
    setError("");
    try {
      setData(await api<MapData>(`/api/courses/${courseId}/map`));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "스테이지를 불러오지 못했어요");
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId]);

  async function copyReview(unit: number) {
    const text = `PassFinder "${courseTitle}" 과목 유닛 ${unit}의 검수 필요 문항을 get_review_batch로 받아 2차 검수해줘. 문항마다 정답·근거·난이도·선택지를 확인하고 submit_reviews로 통과/수정 제안/불합격과 사유를 보내줘.`;
    try {
      await navigator.clipboard.writeText(text);
      setNotice({ text: "내 AI에 붙여 넣을 문장을 복사했어요. 검수한 문항은 내 스테이지 출제 대상에 더해져요." });
    } catch {
      setNotice({ text });
    }
  }

  function open(s: Stage) {
    if (s.state === "locked") return setNotice({ text: "앞 스테이지를 먼저 깨 주세요" });
    if (s.state === "paywall") {
      return setNotice({ text: "첫 유닛(스테이지 5개)까지는 무료예요. 6번째 스테이지부터는 이용권이 필요해요.", pay: true });
    }
    router.push(`/courses/${courseId}/play/${s.conceptId}`);
  }

  if (error)
    return (
      <div className="card space-y-2">
        <p className="msg-error">{error}</p>
        <button className="btn btn-ghost" onClick={load}>
          다시 불러오기
        </button>
      </div>
    );
  if (!data) return <p className="text-[var(--muted)]">스테이지를 불러오는 중…</p>;
  if (!data.stages.length)
    return (
      <div className="card text-[var(--muted)]">
        아직 스테이지가 없어요. 내 AI에 MCP 주소를 등록하고 개념을 만들어 달라고 해 보세요. 아래 &quot;MCP 주소 복사&quot;에서 시작할 수 있어요.
      </div>
    );

  const units = [...new Set(data.stages.map((s) => s.unit))];
  return (
    <div className="space-y-4">
      <div className="card space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span>
            진행 {data.progress.cleared}/{data.progress.total} · {data.progress.percent}%
          </span>
          <span className="font-semibold">누적 {data.xp} XP</span>
        </div>
        <div className="h-2 rounded-full bg-[var(--line)]">
          <div className="h-2 rounded-full bg-[var(--accent)]" style={{ width: `${data.progress.percent}%` }} />
        </div>
      </div>

      {notice && (
        <div className="card flex flex-wrap items-center justify-between gap-2" role="status">
          <span>{notice.text}</span>
          {notice.pay && (
            <a className="btn" href={`/courses/${courseId}/pay`}>
              이용권 보기
            </a>
          )}
        </div>
      )}

      {units.map((unit) => {
        const review = data.units.find((u) => u.unit === unit)?.reviewNeeded ?? 0;
        return (
          <div key={unit} className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] pb-1">
              <span className="font-semibold">
                유닛 {unit}
                {unit >= 2 && !data.hasAccess && <span className="ml-2 text-xs text-[var(--muted)]">이용권</span>}
              </span>
              {review > 0 && (
                <button className="rounded-full border border-[var(--accent)] px-3 py-1 text-xs text-[var(--accent)]" onClick={() => copyReview(unit)}>
                  검수 필요 {review}개 · 내 AI에 보낼 문장 복사
                </button>
              )}
            </div>
            <ol className="space-y-2">
              {data.stages
                .filter((s) => s.unit === unit)
                .map((s) => (
                  <li key={s.conceptId}>
                    <button
                      onClick={() => open(s)}
                      className={`card flex w-full items-center gap-3 text-left ${s.state === "open" ? "border-[var(--accent)] ring-2 ring-[var(--accent)]" : ""} ${
                        s.state === "locked" || s.state === "paywall" ? "opacity-60" : ""
                      }`}
                    >
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--line)] font-bold">
                        {s.state === "locked" || s.state === "paywall" ? "🔒" : s.order}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">{s.name}</span>
                        <span className="text-sm text-[var(--muted)]">
                          {starText(s.stars)} ·{" "}
                          {s.state === "open"
                            ? "지금 도전"
                            : s.state === "cleared"
                              ? s.stars === 3
                                ? "마스터"
                                : "다음 별 도전"
                              : s.state === "paywall"
                                ? "이용권 필요"
                                : "잠김"}
                          {s.needsReview && s.state === "cleared" && " · 복습 필요"}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
            </ol>
          </div>
        );
      })}
    </div>
  );
}
