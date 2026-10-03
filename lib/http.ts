// API 응답 공통 형식(설계서 8절): 실패는 { error: 코드, message: 화면에 보여 줄 문장 }
export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export function ok(data: unknown, status = 200) {
  return Response.json(data, { status });
}

export function fail(status: number, code: string, message: string, extra?: Record<string, unknown>) {
  return Response.json({ error: code, message, ...extra }, { status });
}

// Route Handler를 감싸 HttpError는 그대로, 나머지 예외는 500 한 문장으로 돌려준다.
export function handle<C>(fn: (req: Request, ctx: C) => Promise<Response>) {
  return async (req: Request, ctx: C) => {
    try {
      return await fn(req, ctx);
    } catch (e) {
      if (e instanceof HttpError) return fail(e.status, e.code, e.message, e.extra);
      console.error(e);
      return fail(500, "server_error", "잠시 문제가 생겼어요. 다시 시도해 주세요");
    }
  };
}

export async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, "invalid", "요청 형식이 올바르지 않아요");
  }
}
