// MCP 서버(FR-02·03, 소유: MCP·검수 모듈). 상태 비저장 Streamable HTTP: POST로 JSON-RPC를 받고 JSON으로 답한다.
// 지원 메서드: initialize, notifications/*, ping, tools/list, tools/call. 알림 스트림(GET)은 지원하지 않는다(405).
import { createHash } from "node:crypto";
import { db } from "@/lib/supabase-admin";
import { HttpError } from "@/lib/http";
import { TOOLS, ToolError } from "@/lib/mcp/tools";

export const maxDuration = 60;

const VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const INSTRUCTIONS =
  "PassFinder는 교안으로 시험 대비 문항을 만들고 같은 수업 학생끼리 검수하는 서비스다. 문제 만들기 순서: list_courses → get_course_context(교안 읽기) → submit_concepts(개념 등록) → get_question_bank → submit_questions(1차 검수 후 제출). 다른 학생 문항 검수: get_review_batch → submit_reviews.";

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };

async function userFromToken(token: string): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
  const hash = createHash("sha256").update(token).digest("hex");
  const { data } = await db().from("mcp_tokens").select("user_id").eq("token_hash", hash).maybeSingle();
  if (!data) return null;
  void db().from("mcp_tokens").update({ last_used_at: new Date().toISOString() }).eq("token_hash", hash).then(() => {});
  return data.user_id as string;
}

const error = (id: Rpc["id"], code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
const result = (id: Rpc["id"], value: unknown) => ({ jsonrpc: "2.0", id, result: value });

async function handleMessage(msg: Rpc, userId: string | null, req: Request) {
  if (msg.id === undefined || msg.id === null) return null; // 알림에는 답하지 않는다
  if (!userId) return error(msg.id, -32001, "연결 주소가 올바르지 않아요. PassFinder 과목 화면에서 MCP 주소를 다시 복사해 주세요");
  switch (msg.method) {
    case "initialize": {
      const asked = String(msg.params?.protocolVersion ?? "");
      return result(msg.id, {
        protocolVersion: VERSIONS.includes(asked) ? asked : "2025-06-18",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "passfinder", title: "PassFinder", version: "0.1.0" },
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return result(msg.id, {});
    case "tools/list":
      return result(msg.id, { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    case "tools/call": {
      const name = String(msg.params?.name ?? "");
      const tool = TOOLS.find((t) => t.name === name);
      if (!tool) return error(msg.id, -32602, `없는 도구예요: ${name}`);
      try {
        const out = await tool.run(userId, (msg.params?.arguments ?? {}) as Record<string, unknown>, req);
        return result(msg.id, { content: [{ type: "text", text: JSON.stringify(out) }] });
      } catch (e) {
        const text = e instanceof ToolError || e instanceof HttpError ? e.message : "잠시 문제가 생겼어요. 다시 시도해 주세요";
        if (!(e instanceof ToolError)) console.error("tool failed", name, e);
        return result(msg.id, { content: [{ type: "text", text }], isError: true });
      }
    }
    default:
      return error(msg.id, -32601, `지원하지 않는 요청이에요: ${msg.method}`);
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  let body: Rpc | Rpc[];
  try {
    body = await req.json();
  } catch {
    return Response.json(error(null, -32700, "요청 형식이 올바르지 않아요"), { status: 400 });
  }
  const userId = await userFromToken(token);
  const messages = Array.isArray(body) ? body : [body];
  const replies = [];
  for (const m of messages) {
    const r = await handleMessage(m, userId, req);
    if (r) replies.push(r);
  }
  if (!replies.length) return new Response(null, { status: 202 });
  return Response.json(Array.isArray(body) ? replies : replies[0]);
}

export async function GET() {
  return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
}

export async function DELETE() {
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}
