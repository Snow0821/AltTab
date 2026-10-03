"use client";
// 스테이지 맵 (FR-04, 담당: 박예나 화면 / 장용선 GET /api/courses/{id}/map). 응답 형식은 설계서 8절.
// 지금은 API가 준비되기 전까지 안내만 보인다.
export default function StageMap({ courseId }: { courseId: string }) {
  return (
    <div className="card text-[var(--muted)]" data-course={courseId}>
      스테이지 맵 준비 중이에요.
    </div>
  );
}
