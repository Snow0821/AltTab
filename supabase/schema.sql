-- PassFinder 데이터베이스 스키마 (정본: docs/설계.md 6절)
-- 원칙
--  1. 모든 읽기·쓰기는 서버 코드가 service role 키로 한다. 브라우저는 로그인만 Supabase에 직접 한다.
--     그래서 모든 표에 RLS를 켜고 정책을 두지 않는다. 익명 키로는 어떤 행도 읽거나 쓸 수 없다.
--  2. 표마다 쓰기 모듈은 하나다(주석의 "쓰기:" 참고). 다른 모듈은 읽기만 한다.
--  3. 문항 상태(1차 통과·검증 완료·숨김)는 저장하지 않고 검수·신고 기록에서 계산한다(question_status 뷰).
-- 여러 번 실행해도 같은 결과가 나오도록 if not exists / or replace 를 쓴다.

create extension if not exists vector;
create extension if not exists pgcrypto;

-- ── 과목 (쓰기: 과목 모듈) ─────────────────────────────
create table if not exists courses (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 60),
  join_code text not null unique check (join_code ~ '^[A-Z0-9]{6}$'),
  owner_id uuid not null references auth.users(id) on delete cascade,
  exam_date date,
  created_at timestamptz not null default now()
);

create table if not exists course_members (
  course_id uuid not null references courses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (course_id, user_id)
);

-- ── 교안 (쓰기: 교안 모듈) ─────────────────────────────
-- no: 과목 안의 교안 번호(1~20). 근거 위치는 "교안번호:쪽" 문자열(예: "1:15")로 가리킨다.
create table if not exists materials (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses(id) on delete cascade,
  no smallint not null check (no between 1 and 20),
  uploader_id uuid not null references auth.users(id),
  filename text not null,
  file_hash text not null,
  size_bytes integer not null check (size_bytes between 1024 and 52428800),
  page_count integer not null check (page_count > 0),
  status text not null default 'uploaded' check (status in ('uploaded', 'indexing', 'ready', 'failed')),
  chunk_count integer not null default 0,
  embedded boolean not null default false,
  error text,
  created_at timestamptz not null default now(),
  unique (course_id, file_hash),
  unique (course_id, no)
);

create table if not exists chunks (
  id bigint generated always as identity primary key,
  material_id uuid not null references materials(id) on delete cascade,
  course_id uuid not null references courses(id) on delete cascade,
  material_no smallint not null,
  page integer not null,
  seq integer not null,
  content text not null,
  embedding vector(1536),
  unique (material_id, seq)
);
create index if not exists chunks_course_ref on chunks (course_id, material_no, page);

-- ── 개념·문항·검수 (쓰기: MCP·검수 모듈) ───────────────
create table if not exists concepts (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses(id) on delete cascade,
  author_id uuid not null references auth.users(id),
  name text not null check (char_length(name) between 1 and 60),
  summary text not null check (char_length(summary) between 1 and 300),
  evidence_refs text[] not null check (cardinality(evidence_refs) > 0),
  prerequisites text[] not null default '{}',
  importance real check (importance between 0 and 1),
  created_at timestamptz not null default now(),
  unique (course_id, name)
);

-- ★1 기초·★2 적용 = 객관식(choice), ★3 응용 = 단답형(short).
-- 객관식은 선택지 3~5개(정답 1 + 오답 2~4)이고 정답이 선택지 안에 있어야 한다.
create table if not exists questions (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses(id) on delete cascade,
  concept_id uuid not null references concepts(id) on delete cascade,
  author_id uuid not null references auth.users(id),
  difficulty smallint not null check (difficulty between 1 and 3),
  qtype text not null check (qtype in ('choice', 'short')),
  body text not null check (char_length(body) between 5 and 1000),
  body_norm text not null,
  choices text[],
  answer text not null,
  accepted_answers text[] not null default '{}',
  explanation text not null,
  evidence_refs text[] not null check (cardinality(evidence_refs) > 0),
  check_note text,
  evidence_score real,
  created_at timestamptz not null default now(),
  unique (concept_id, body_norm),
  check (
    (qtype = 'choice' and difficulty in (1, 2) and choices is not null
       and cardinality(choices) between 3 and 5 and answer = any (choices))
    or (qtype = 'short' and difficulty = 3 and choices is null)
  )
);

-- stage 1 = 출제자 AI의 1차 검수(통과한 문항만 저장되므로 verdict는 pass), stage 2 = 다른 학생 AI의 2차 검수
create table if not exists review_log (
  id bigint generated always as identity primary key,
  question_id uuid not null references questions(id) on delete cascade,
  reviewer_id uuid not null references auth.users(id),
  stage smallint not null check (stage in (1, 2)),
  verdict text not null check (verdict in ('pass', 'revise', 'fail')),
  checklist jsonb,
  reason text not null check (char_length(reason) between 1 and 300),
  suggested_difficulty smallint check (suggested_difficulty between 1 and 3),
  created_at timestamptz not null default now(),
  unique (question_id, reviewer_id, stage)
);

-- ── 풀이 (쓰기: 퀴즈 모듈) ─────────────────────────────
create table if not exists reports (
  question_id uuid not null references questions(id) on delete cascade,
  reporter_id uuid not null references auth.users(id),
  reason text not null check (reason in ('wrong_answer', 'ambiguous', 'out_of_scope')),
  created_at timestamptz not null default now(),
  primary key (question_id, reporter_id)
);

create table if not exists attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid not null references courses(id) on delete cascade,
  concept_id uuid not null references concepts(id) on delete cascade,
  difficulty smallint not null check (difficulty between 1 and 3),
  mode text not null default 'stage' check (mode in ('stage', 'review')),
  question_ids uuid[] not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  correct_count smallint,
  cleared boolean,
  xp_gained integer
);

-- round 2 = 틀린 문제를 끝에 한 번 더 푼 기록(클리어 판정에는 넣지 않는다)
create table if not exists attempt_answers (
  attempt_id uuid not null references attempts(id) on delete cascade,
  question_id uuid not null references questions(id) on delete cascade,
  round smallint not null default 1 check (round in (1, 2)),
  answer text not null,
  correct boolean not null,
  answered_at timestamptz not null default now(),
  primary key (attempt_id, question_id, round)
);

create table if not exists stage_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  concept_id uuid not null references concepts(id) on delete cascade,
  course_id uuid not null references courses(id) on delete cascade,
  stars smallint not null default 0 check (stars between 0 and 3),
  mastery real not null default 0 check (mastery between 0 and 1),
  next_review_at timestamptz,
  review_interval_days real,
  updated_at timestamptz not null default now(),
  primary key (user_id, concept_id)
);

create table if not exists xp_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid not null references courses(id) on delete cascade,
  attempt_id uuid references attempts(id) on delete set null,
  amount integer not null,
  reason text not null check (reason in ('correct', 'clear', 'perfect')),
  created_at timestamptz not null default now()
);

-- ── 결제·이용권 (쓰기: 결제 모듈) ──────────────────────
create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product text not null check (product in ('course_pass', 'exam_30d')),
  course_id uuid references courses(id) on delete set null,
  amount integer not null check (amount > 0),
  provider text not null check (provider in ('mock', 'toss_test')),
  status text not null check (status in ('paid', 'failed')),
  fail_reason text,
  idempotency_key text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('course_pass', 'exam_30d')),
  course_id uuid references courses(id) on delete cascade,
  payment_id uuid not null unique references payments(id),
  starts_at timestamptz not null default now(),
  expires_at timestamptz, -- 과목 이용권은 기간 제한 없음(null), 구독은 결제 시각 + 30일
  check ((kind = 'course_pass' and course_id is not null and expires_at is null)
      or (kind = 'exam_30d' and course_id is null and expires_at is not null))
);

-- ── MCP 토큰 (쓰기: MCP 모듈) ──────────────────────────
-- 사용자당 1개. 원문 토큰은 저장하지 않고 SHA-256 해시만 둔다. 다시 발급하면 이전 주소는 끊긴다.
create table if not exists mcp_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

-- ── 유도 속성: 문항 상태 ──────────────────────────────
-- 검증 완료 = 출제자가 아닌 서로 다른 학생 2명이 2차 통과
-- 숨김     = 2차 불합격 2건 이상 또는 신고 3건 이상 (숨김이 우선)
-- 1차 통과 = 나머지
create or replace view question_status with (security_invoker = true) as
select
  q.id as question_id, q.course_id, q.concept_id, q.author_id, q.difficulty,
  coalesce(r.passes, 0)::int as passes,
  coalesce(r.fails, 0)::int as fails,
  coalesce(p.reports, 0)::int as reports,
  case
    when coalesce(r.fails, 0) >= 2 or coalesce(p.reports, 0) >= 3 then 'hidden'
    when coalesce(r.passes, 0) >= 2 then 'verified'
    else 'first_pass'
  end as status
from questions q
left join (
  select l.question_id,
         count(distinct l.reviewer_id) filter (where l.verdict = 'pass') as passes,
         count(distinct l.reviewer_id) filter (where l.verdict = 'fail') as fails
  from review_log l
  join questions q2 on q2.id = l.question_id
  where l.stage = 2 and l.reviewer_id <> q2.author_id
  group by l.question_id
) r on r.question_id = q.id
left join (
  select question_id, count(*) as reports from reports group by question_id
) p on p.question_id = q.id;

-- 질문 문장과 가까운 교안 조각 찾기(get_course_context의 query)
create or replace function match_chunks(p_course uuid, p_embedding vector(1536), p_limit int)
returns table (material_no smallint, page int, content text, similarity float)
language sql stable as $$
  select c.material_no, c.page, c.content, 1 - (c.embedding <=> p_embedding) as similarity
  from chunks c
  where c.course_id = p_course and c.embedding is not null
  order by c.embedding <=> p_embedding
  limit p_limit;
$$;

-- ── 접근 차단 ─────────────────────────────────────────
alter table courses enable row level security;
alter table course_members enable row level security;
alter table materials enable row level security;
alter table chunks enable row level security;
alter table concepts enable row level security;
alter table questions enable row level security;
alter table review_log enable row level security;
alter table reports enable row level security;
alter table attempts enable row level security;
alter table attempt_answers enable row level security;
alter table stage_progress enable row level security;
alter table xp_log enable row level security;
alter table payments enable row level security;
alter table entitlements enable row level security;
alter table mcp_tokens enable row level security;
revoke all on question_status from anon, authenticated;
revoke execute on function match_chunks(uuid, vector, int) from public, anon, authenticated;
