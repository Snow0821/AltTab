"use client";
// 과목 홈 = 스테이지 맵 (FR-04, 담당: 박예나). 아래 탭의 교안·MCP 패널은 이제민, 결제는 박재현 담당 컴포넌트를 끼운다.
import { use, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api-client";
import MaterialsPanel from "@/components/MaterialsPanel";
import McpPanel from "@/components/McpPanel";
import StageMap from "@/components/StageMap";
import AiGeneratePanel from "@/components/AiGeneratePanel";

type CourseInfo = {
  course: { id: string; title: string; joinCode: string; role: string };
  access: { has: boolean; kind: string | null; expiresAt: string | null };
};

export default function CoursePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [info, setInfo] = useState<CourseInfo | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"materials" | "mcp" | "invite">("materials");
  const [mapVersion, setMapVersion] = useState(0);

  useEffect(() => {
    api<CourseInfo>(`/api/courses/${id}`)
      .then(setInfo)
      .catch((e) => setError(e instanceof ApiError ? e.message : "과목을 불러오지 못했어요"));
  }, [id]);

  if (error) return <p className="card msg-error">{error}</p>;
  if (!info) return <p className="text-[var(--muted)]">불러오는 중…</p>;

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">{info.course.title}</h1>
        {info.access.has && <span className="rounded-full bg-[var(--ok)] px-2 py-0.5 text-xs text-white">이용 중</span>}
      </div>
      <p className="text-sm text-[var(--muted)]">
        참여 코드 <span className="font-mono text-base font-bold tracking-widest text-[var(--ink)]">{info.course.joinCode}</span> · 같은 수업 친구가 이 코드로 들어올 수 있어요
      </p>

      <StageMap key={mapVersion} courseId={id} courseTitle={info.course.title} />

      <AiGeneratePanel courseId={id} onDone={() => setMapVersion((v) => v + 1)} />

      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <button className={`btn ${tab === "materials" ? "" : "btn-ghost"}`} onClick={() => setTab("materials")}>
            교안 업로드
          </button>
          <button className={`btn ${tab === "mcp" ? "" : "btn-ghost"}`} onClick={() => setTab("mcp")}>
            MCP 주소 복사
          </button>
          <button className={`btn ${tab === "invite" ? "" : "btn-ghost"}`} onClick={() => setTab("invite")}>
            참여 코드
          </button>
          <a className="btn btn-ghost" href={`/courses/${id}/pay`}>
            결제
          </a>
        </div>
        {tab === "materials" && <MaterialsPanel courseId={id} />}
        {tab === "mcp" && <McpPanel courseTitle={info.course.title} />}
        {tab === "invite" && (
          <div className="card space-y-2">
            <p>같은 수업을 듣는 친구에게 이 코드를 알려 주세요. 친구는 과목 목록의 "참여 코드로 들어가기"에 넣으면 돼요.</p>
            <p className="text-3xl font-bold tracking-widest">{info.course.joinCode}</p>
            <p className="text-sm text-[var(--muted)]">교안·스테이지·문항은 함께 쓰고, 진도·XP·이용권은 각자 따로예요.</p>
          </div>
        )}
      </div>
    </section>
  );
}
