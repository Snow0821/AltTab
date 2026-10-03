-- 본인 프로젝트 nwatlpkwenucgyexeopz 전용. 기존 학습·로그인 테이블은 변경하지 않는다.
begin;
create table if not exists public.alttab_connection_test (
  id boolean primary key default true check (id = true),
  value text not null check (char_length(value) <= 200),
  updated_at timestamptz not null default now(),
  llm_claimed_at timestamptz
);
alter table public.alttab_connection_test enable row level security;
commit;
