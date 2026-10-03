"use client";
// 브라우저는 Supabase에 로그인만 한다. 표는 직접 읽지 않고 /api 를 거친다.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

export function supabaseBrowser(): SupabaseClient {
  if (!client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) throw new Error("Supabase 공개 환경 변수가 없습니다");
    client = createClient(url, key);
  }
  return client;
}
