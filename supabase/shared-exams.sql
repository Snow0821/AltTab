-- passfinder 공유 시험·응시 테이블 (FR-13~15). 서버의 서비스 키만 읽고 쓴다.
-- 적용: DB 소유자가 Supabase SQL Editor 또는 psql로 1회 실행한다. 여러 번 실행해도 결과가 같다.
-- 기존 Next 테이블(attempts, attempt_answers, questions 등)과 이름이 겹치지 않으며 건드리지 않는다.

create table if not exists public.shared_exams (
  set_id uuid primary key,
  exam_id text not null,
  exam_version integer not null default 1 check (exam_version >= 1),
  share_code text not null,
  title text not null,
  course_id text,
  source text,
  author_participant_id text,
  -- 제목·과목·문항 내용의 해시. 같은 작성자가 같은 세트를 연타·재전송해도 한 번만 저장한다.
  fingerprint text,
  -- 문항·보기·정답·해설·근거 전체. 브라우저에는 서버가 정답·해설을 뺀 형태만 보낸다.
  questions jsonb not null,
  created_at timestamptz not null default now(),
  constraint shared_exams_exam_version_key unique (exam_id, exam_version),
  constraint shared_exams_share_code_key unique (share_code)
);
create unique index if not exists shared_exams_author_fingerprint
  on public.shared_exams (author_participant_id, fingerprint)
  where author_participant_id is not null and fingerprint is not null;

create table if not exists public.shared_attempts (
  attempt_id uuid primary key,
  set_id uuid not null references public.shared_exams (set_id),
  exam_id text not null,
  exam_version integer not null,
  participant_id text not null,
  nickname text,
  answers jsonb,
  score integer,
  max_score integer,
  correct_count integer,
  question_count integer,
  graded boolean not null default false,
  counted boolean not null default false,
  counted_reason text,
  solution_text text check (solution_text is null or char_length(solution_text) between 1 and 300),
  solution_shared_at timestamptz,
  created_at timestamptz not null default now(),
  graded_at timestamptz
);

-- 참가자·시험·버전당 집계 응시는 하나만. 첫 완료만 counted=true가 되고 동시 요청도 DB가 막는다.
create unique index if not exists shared_attempts_one_counted
  on public.shared_attempts (participant_id, exam_id, exam_version)
  where counted;
create index if not exists shared_attempts_exam_idx
  on public.shared_attempts (exam_id, exam_version);
create index if not exists shared_attempts_participant_idx
  on public.shared_attempts (participant_id, exam_id, exam_version);

-- 정책을 만들지 않는다: 공개(anon)·일반 사용자 키로는 읽기·쓰기가 모두 막히고 서버의 서비스 키만 접근한다.
alter table public.shared_exams enable row level security;
alter table public.shared_attempts enable row level security;
