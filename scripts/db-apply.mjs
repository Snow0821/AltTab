// supabase/schema.sql 을 Supabase Postgres에 적용한다. 여러 번 실행해도 결과가 같다.
// 필요: .env.local 의 POSTGRES_URL_NON_POOLING (vercel env pull 로 받음)
import { readFileSync, existsSync } from "node:fs";
import postgres from "postgres";

if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
  }
}
const url = process.env.POSTGRES_URL_NON_POOLING ?? process.env.POSTGRES_URL;
if (!url) {
  console.error("POSTGRES_URL_NON_POOLING 이 없습니다. vercel env pull .env.local 을 먼저 실행하세요.");
  process.exit(1);
}
const sql = postgres(url, { ssl: "require", max: 1, onnotice: () => {} });
try {
  await sql.unsafe(readFileSync("supabase/schema.sql", "utf8"));
  const tables = await sql`select table_name from information_schema.tables where table_schema = 'public' order by 1`;
  console.log("적용 완료. public 표:", tables.map((t) => t.table_name).join(", "));
} catch (e) {
  console.error("적용 실패:", e.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
