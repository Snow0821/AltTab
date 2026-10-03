"use client";
// 교안 업로드 (FR-01, 담당: 이제민)
export default function MaterialsPanel({ courseId }: { courseId: string }) {
  return (
    <div className="card text-[var(--muted)]" data-course={courseId}>
      교안 업로드 준비 중이에요.
    </div>
  );
}
