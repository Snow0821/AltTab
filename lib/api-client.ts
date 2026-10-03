"use client";
// 화면에서 /api 를 부를 때 쓰는 함수. 로그인 토큰을 붙이고, 실패하면 message를 담은 ApiError를 던진다.
import { supabaseBrowser } from "./supabase-browser";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public body: Record<string, unknown>,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, body?: unknown, method?: string): Promise<T> {
  const { data } = await supabaseBrowser().auth.getSession();
  const token = data.session?.access_token;
  let res: Response;
  try {
    res = await fetch(path, {
      method: method ?? (body === undefined ? "GET" : "POST"),
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "network", "인터넷 연결을 확인하고 다시 시도해 주세요", {});
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new ApiError(
      res.status,
      String(json.error ?? "error"),
      String(json.message ?? "잠시 문제가 생겼어요. 다시 시도해 주세요"),
      json,
    );
  }
  return json as T;
}
