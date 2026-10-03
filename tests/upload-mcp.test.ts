// 교안 업로드 크기·청크 보존, MCP 전송 계층 검사 회귀 테스트
import { test } from "node:test";
import assert from "node:assert/strict";
import { fitsUpload, uploadBytes, MAX_UPLOAD_BYTES } from "../lib/upload.ts";
import { chunkPages } from "../lib/chunk.ts";
import { checkTransport } from "../lib/mcp/transport.ts";

const body = (pages: { page: number; text: string }[]) => ({ filename: "a.pdf", fileHash: "0".repeat(64), sizeBytes: 2048, pages });

test("업로드 크기는 글자 수가 아니라 UTF-8 바이트로 판단한다", () => {
  const korean = "가".repeat(4000);
  const big = body(Array.from({ length: 400 }, (_, i) => ({ page: i + 1, text: korean }))); // 160만 자, 약 480만 바이트
  assert.ok(uploadBytes(big) > MAX_UPLOAD_BYTES);
  assert.equal(fitsUpload(big), false);
  const small = body(Array.from({ length: 100 }, (_, i) => ({ page: i + 1, text: "가".repeat(3000) })));
  assert.equal(fitsUpload(small), true);
  const emoji = body([{ page: 1, text: "😀\"\\\n".repeat(1000) }]); // 이모지 4바이트, 이스케이프 문자 포함
  assert.equal(uploadBytes(emoji), new TextEncoder().encode(JSON.stringify(emoji)).length);
});

test("6,000자를 넘는 쪽도 끝까지 청크에 남는다", () => {
  const text = "앞부분 내용 ".repeat(1000).slice(0, 6000) + "끝부분근거XYZ"; // 6,008자
  const chunks = chunkPages([{ page: 7, text }]);
  const joined = chunks.map((c) => c.content).join(" ");
  assert.ok(joined.includes("끝부분근거XYZ"));
  assert.ok(chunks.every((c) => c.page === 7));
  assert.ok(chunks.every((c) => c.content.length <= 900));
});

const h = (o: Record<string, string>) => ({ get: (k: string) => o[k.toLowerCase()] ?? null });

test("MCP: 허용되지 않은 Origin은 403, Origin 없는 클라이언트는 통과", () => {
  const self = "https://passfinder.vercel.app";
  assert.deepEqual(checkTransport(h({ origin: "https://untrusted.example" }), self), { ok: false, status: 403, message: "허용되지 않은 출처의 요청이에요" });
  assert.equal(checkTransport(h({}), self).ok, true);
  assert.equal(checkTransport(h({ origin: self }), self).ok, true);
  assert.equal(checkTransport(h({ origin: "https://claude.ai" }), self).ok, true);
});

test("MCP: 지원하지 않는 프로토콜 버전 헤더는 400", () => {
  const self = "https://passfinder.vercel.app";
  const bad = checkTransport(h({ "mcp-protocol-version": "9999-99-99" }), self);
  assert.equal(bad.ok, false);
  assert.equal(!bad.ok && bad.status, 400);
  assert.equal(checkTransport(h({ "mcp-protocol-version": "2025-06-18" }), self).ok, true);
});
