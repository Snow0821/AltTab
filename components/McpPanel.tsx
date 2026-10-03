"use client";
// MCP 주소 복사 (FR-02, 담당: 이제민)
export default function McpPanel({ courseTitle }: { courseTitle: string }) {
  return <div className="card text-[var(--muted)]">{courseTitle} MCP 연결 준비 중이에요.</div>;
}
