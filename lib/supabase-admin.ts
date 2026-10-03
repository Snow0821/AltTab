// 서버 전용 DB 클라이언트. service role 키를 쓰므로 Route Handler에서만 import 한다.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ConfigError } from "./http";

let client: SupabaseClient | null = null;

export function db(): SupabaseClient {
  if (!client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
    if (!url || !key) throw new ConfigError("Supabase 환경 변수(URL, service role 키)가 없습니다");
    client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return client;
}
