"use client";
// MCP 주소 복사 (FR-02, 담당: 이제민). 주소에는 개인 연결 키가 들어 있어 만들 때 한 번만 보여 준다.
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api-client";

export default function McpPanel({ courseTitle }: { courseTitle: string }) {
  const [exists, setExists] = useState<boolean | null>(null);
  const [url, setUrl] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const prompt = `PassFinder의 "${courseTitle}" 과목 교안을 읽고 핵심 개념을 쉬운 것부터 뽑아 등록한 뒤, 개념마다 난이도 1~3 문제를 만들어 1차 검수를 하고 올려줘.`;

  useEffect(() => {
    api<{ exists: boolean }>("/api/mcp-token")
      .then((r) => setExists(r.exists))
      .catch(() => setExists(false));
  }, []);

  async function issue() {
    setBusy(true);
    setMessage("");
    try {
      const r = await api<{ url: string }>("/api/mcp-token", {});
      setUrl(r.url);
      setExists(true);
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : "주소를 만들지 못했어요");
    } finally {
      setBusy(false);
    }
  }

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setMessage(`${label} 복사했어요`);
    } catch {
      setMessage("복사하지 못했어요. 직접 선택해서 복사해 주세요");
    }
  }

  return (
    <div className="card space-y-3">
      <p className="font-semibold">내 AI와 연결하기</p>
      <ol className="list-decimal space-y-1 pl-5 text-sm">
        <li>아래에서 MCP 주소를 만들고 복사해요.</li>
        <li>
          Claude Desktop은 설정의 커넥터에서 사용자 지정 커넥터를 추가해 주소를 붙여 넣어요. Claude Code는{" "}
          <code className="rounded bg-[var(--line)] px-1">claude mcp add --transport http passfinder 주소</code>를 실행해요.
        </li>
        <li>AI에게 아래 문장을 보내면 개념과 문제가 만들어져 스테이지에 나타나요.</li>
      </ol>
      {url ? (
        <div className="space-y-2">
          <input className="input font-mono text-xs" readOnly value={url} onFocus={(e) => e.target.select()} />
          <button className="btn w-full" onClick={() => copy(url, "MCP 주소를")}>
            MCP 주소 복사
          </button>
          <p className="text-xs text-[var(--muted)]">이 주소는 지금만 보여요. 다른 사람에게 알려 주지 마세요.</p>
        </div>
      ) : (
        <button className="btn w-full" disabled={busy || exists === null} onClick={issue}>
          {busy ? "만드는 중…" : exists ? "새 MCP 주소 만들기(이전 주소는 끊겨요)" : "MCP 주소 만들기"}
        </button>
      )}
      <div className="space-y-2 rounded-lg bg-[var(--bg)] p-3 text-sm">
        <p>{prompt}</p>
        <button className="btn btn-ghost px-3 py-1 text-xs" onClick={() => copy(prompt, "AI에게 보낼 문장을")}>
          문장 복사
        </button>
      </div>
      {message && <p className="text-sm">{message}</p>}
      <p className="text-xs text-[var(--muted)]">문제 만들기와 검수는 무료예요. 이용권은 6번째 스테이지부터 풀 때 필요해요.</p>
    </div>
  );
}
