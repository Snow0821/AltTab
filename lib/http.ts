// API 응답 공통 형식(설계서 8절): 실패는 { error: 코드, message: 화면에 보여 줄 문장 }
import { InvalidInput, asObject, type Body } from "./validate.ts";

export class HttpError extends Error {
  status: number;
  code: string;
  extra?: Record<string, unknown>;
  constructor(status: number, code: string, message: string, extra?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

// 배포 환경 변수가 아직 없을 때(예: Supabase 연결 전) 쓰는 오류. 500 대신 503 안내로 바꾼다.
export class ConfigError extends Error {}

export function ok(data: unknown, status = 200) {
  return Response.json(data, { status });
}

export function fail(status: number, code: string, message: string, extra?: Record<string, unknown>) {
  return Response.json({ error: code, message, ...extra }, { status });
}

// Route Handler를 감싸 HttpError·InvalidInput은 그대로, 나머지 예외는 500 한 문장으로 돌려준다.
export function handle<C>(fn: (req: Request, ctx: C) => Promise<Response>) {
  return async (req: Request, ctx: C) => {
    try {
      return await fn(req, ctx);
    } catch (e) {
      if (e instanceof HttpError) return fail(e.status, e.code, e.message, e.extra);
      if (e instanceof InvalidInput) return fail(400, "invalid", e.message);
      if (e instanceof ConfigError) return fail(503, "not_configured", "서비스를 준비하고 있어요. 잠시 후 다시 시도해 주세요");
      console.error(e);
      return fail(500, "server_error", "잠시 문제가 생겼어요. 다시 시도해 주세요");
    }
  };
}

// JSON 본문을 읽고 객체인지 확인한다. 잘못된 JSON, null, 배열, 숫자는 400 invalid.
export async function readJson(req: Request): Promise<Body> {
  let parsed: unknown;
  try {
    parsed = await req.json();
  } catch {
    throw new InvalidInput("요청 형식이 올바르지 않아요");
  }
  return asObject(parsed);
}
