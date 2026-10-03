// MCP 전송 계층 검사(MCP 명세 2025-11-25 Transports). 도구를 실행하기 전에 확인한다.
// - Origin 헤더가 있으면 자기 주소나 허용 목록일 때만 받는다(아니면 403). 브라우저가 아닌 MCP 클라이언트는 Origin을 보내지 않는다.
// - MCP-Protocol-Version 헤더가 있는데 지원하지 않는 값이면 400. 없으면 받는다(명세상 2025-03-26으로 간주).
export const VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
export const DEFAULT_ALLOWED_ORIGINS = ["https://claude.ai", "https://claude.com"];

export type TransportCheck = { ok: true } | { ok: false; status: 400 | 403; message: string };

export function checkTransport(
  headers: { get(name: string): string | null },
  selfOrigin: string,
  allowedOrigins: string[] = DEFAULT_ALLOWED_ORIGINS,
): TransportCheck {
  const origin = headers.get("origin");
  if (origin && origin !== selfOrigin && !allowedOrigins.includes(origin)) {
    return { ok: false, status: 403, message: "허용되지 않은 출처의 요청이에요" };
  }
  const version = headers.get("mcp-protocol-version");
  if (version && !VERSIONS.includes(version)) {
    return { ok: false, status: 400, message: `지원하지 않는 MCP 프로토콜 버전이에요: ${version}` };
  }
  return { ok: true };
}
