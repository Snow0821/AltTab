// MCP 주소 발급(FR-02, 쓰기: MCP 모듈). 원문 토큰은 이 응답에서 한 번만 보여 주고 해시만 저장한다.
// 다시 발급하면 이전 주소는 끊긴다.
import { createHash, randomBytes } from "node:crypto";
import { db } from "@/lib/supabase-admin";
import { requireUser } from "@/lib/auth";
import { handle, ok } from "@/lib/http";

function origin(req: Request) {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  return host ? `${proto}://${host}` : new URL(req.url).origin;
}

export const GET = handle(async (req) => {
  const user = await requireUser(req);
  const { data, error } = await db().from("mcp_tokens").select("created_at, last_used_at").eq("user_id", user.id).maybeSingle();
  if (error) throw error;
  return ok({ exists: !!data, createdAt: data?.created_at ?? null, lastUsedAt: data?.last_used_at ?? null });
});

export const POST = handle(async (req) => {
  const user = await requireUser(req);
  const token = randomBytes(32).toString("base64url");
  const token_hash = createHash("sha256").update(token).digest("hex");
  const { error } = await db()
    .from("mcp_tokens")
    .upsert({ user_id: user.id, token_hash, created_at: new Date().toISOString(), last_used_at: null }, { onConflict: "user_id" });
  if (error) throw error;
  return ok({ url: `${origin(req)}/api/mcp/${token}` });
});
