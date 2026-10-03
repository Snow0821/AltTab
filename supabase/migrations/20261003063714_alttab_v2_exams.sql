-- v2 is isolated from the legacy score and connection-demo modules.
create table public.alttab_v2_exams (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 100),
  source text not null check (source in ('sample', 'ai')),
  questions jsonb not null check (jsonb_typeof(questions) = 'array' and jsonb_array_length(questions) = 5),
  owner_key text,
  created_at timestamptz not null default now()
);
create table public.alttab_v2_attempts (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.alttab_v2_exams(id),
  participant_key text not null check (participant_key ~ '^[a-f0-9]{64}$'),
  nickname text not null check (char_length(nickname) between 1 and 20),
  score integer check (score between 0 and 100),
  result jsonb,
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  unique (exam_id, participant_key),
  check ((result is null and score is null and submitted_at is null) or
         (result is not null and score is not null and submitted_at is not null))
);
create table public.alttab_v2_generations (
  id uuid primary key default gen_random_uuid(),
  participant_key text not null check (participant_key ~ '^[a-f0-9]{64}$'),
  fingerprint text not null check (fingerprint ~ '^[a-f0-9]{64}$'),
  state text not null default 'pending' check (state in ('pending', 'ready', 'failed')),
  exam_id uuid references public.alttab_v2_exams(id),
  created_at timestamptz not null default now()
);
create index alttab_v2_exams_date_idx on public.alttab_v2_exams(created_at desc);
create index alttab_v2_attempts_ranking_idx on public.alttab_v2_attempts(exam_id, score desc) where score is not null;
create index alttab_v2_generation_owner_idx on public.alttab_v2_generations(participant_key, created_at desc);
create index alttab_v2_generation_date_idx on public.alttab_v2_generations(created_at);
create index alttab_v2_generation_exam_idx on public.alttab_v2_generations(exam_id);

alter table public.alttab_v2_exams enable row level security;
alter table public.alttab_v2_attempts enable row level security;
alter table public.alttab_v2_generations enable row level security;
revoke all on public.alttab_v2_exams, public.alttab_v2_attempts, public.alttab_v2_generations from public, anon, authenticated;
grant select, insert, update, delete on public.alttab_v2_exams, public.alttab_v2_attempts, public.alttab_v2_generations to service_role;

-- Score is computed by the server, never accepted from a player.
-- Same scores share a rank. Nicknames are display names, not verified identities.
create function public.alttab_v2_ranking(p_exam uuid, p_participant text)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with ranked as (
    select nickname, score, submitted_at, id, participant_key,
           rank() over (order by score desc) as position
    from public.alttab_v2_attempts
    where exam_id = p_exam and score is not null
  ), top_rows as (
    select position, nickname, score, (participant_key = p_participant) as mine
    from ranked order by position, submitted_at, id limit 50
  )
  select jsonb_build_object(
    'participants', (select count(*) from ranked),
    'rows', coalesce((select jsonb_agg(to_jsonb(t)) from top_rows t), '[]'::jsonb),
    'mine', (select jsonb_build_object('position', position, 'score', score, 'nickname', nickname) from ranked where participant_key = p_participant)
  );
$$;

-- Durable quotas survive server restarts. No LLM call on repeated identical requests.
-- Failed/uncertain calls consume their allowance; no automatic retries.
create function public.alttab_v2_claim_generation(p_participant text, p_fingerprint text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare previous public.alttab_v2_generations; new_id uuid;
begin
  perform pg_advisory_xact_lock(740213860);
  select * into previous from public.alttab_v2_generations
    where participant_key = p_participant and fingerprint = p_fingerprint
      and (state = 'ready' or (state = 'pending' and created_at > now() - interval '2 minutes'))
    order by created_at desc limit 1;
  if found then
    return jsonb_build_object('state', previous.state, 'examId', previous.exam_id);
  end if;
  if (select count(*) from public.alttab_v2_generations where created_at > now() - interval '24 hours') >= 50
     or (select count(*) from public.alttab_v2_generations where participant_key = p_participant and created_at > now() - interval '1 hour') >= 3 then
    return jsonb_build_object('state', 'limited');
  end if;
  insert into public.alttab_v2_generations(participant_key, fingerprint)
    values (p_participant, p_fingerprint) returning id into new_id;
  return jsonb_build_object('state', 'claimed', 'id', new_id);
end;
$$;
revoke execute on function public.alttab_v2_ranking(uuid,text), public.alttab_v2_claim_generation(text,text) from public, anon, authenticated;
grant execute on function public.alttab_v2_ranking(uuid,text), public.alttab_v2_claim_generation(text,text) to service_role;

create function public.alttab_v2_complete_generation(p_job uuid, p_title text, p_questions jsonb)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare job public.alttab_v2_generations;
begin
  select * into strict job from public.alttab_v2_generations where id = p_job for update;
  if job.state = 'ready' then return job.exam_id; end if;
  if job.state <> 'pending' then raise exception 'generation_not_pending'; end if;
  insert into public.alttab_v2_exams(id, title, source, questions, owner_key)
    values (job.id, p_title, 'ai', p_questions, job.participant_key);
  update public.alttab_v2_generations set state = 'ready', exam_id = job.id where id = p_job;
  return job.id;
end;
$$;
revoke execute on function public.alttab_v2_complete_generation(uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.alttab_v2_complete_generation(uuid,text,jsonb) to service_role;

-- A clearly identified sample exam; rankings start empty and use real submissions.
insert into public.alttab_v2_exams(title, source, questions) values (
 '자료구조 · 핵심 개념', 'sample',
 '[
  {"id":"q1","body":"가장 나중에 들어온 데이터를 가장 먼저 꺼내는 자료구조는 무엇일까요?","choices":["큐 (Queue)","스택 (Stack)","힙 (Heap)","배열 (Array)"],"answerIndex":1,"explanation":"스택은 LIFO(Last In, First Out) 순서로 데이터를 꺼냅니다."},
  {"id":"q2","body":"먼저 들어온 데이터가 먼저 나가는 큐의 처리 방식을 고르세요.","choices":["LIFO","무작위 접근","FIFO","이진 탐색"],"answerIndex":2,"explanation":"큐는 FIFO(First In, First Out) 순서로 데이터를 처리합니다."},
  {"id":"q3","body":"길이가 n인 정렬된 배열에서 이진 탐색의 최악 시간 복잡도는 무엇일까요?","choices":["O(1)","O(log n)","O(n)","O(n²)"],"answerIndex":1,"explanation":"비교할 때마다 탐색 범위를 절반으로 줄이므로 최악 시간 복잡도는 O(log n)입니다."},
  {"id":"q4","body":"연속 메모리에 저장된 배열에서 인덱스로 원소 하나에 접근할 때의 시간 복잡도는 무엇일까요?","choices":["O(1)","O(log n)","O(n)","O(n log n)"],"answerIndex":0,"explanation":"시작 주소와 인덱스로 원소 위치를 직접 계산하므로 O(1)입니다."},
  {"id":"q5","body":"간선의 가중치가 모두 같은 그래프에서 최단 거리 탐색에 알맞은 방법은 무엇일까요?","choices":["깊이 우선 탐색 (DFS)","너비 우선 탐색 (BFS)","선택 정렬","이진 탐색"],"answerIndex":1,"explanation":"BFS는 시작 정점에서 가까운 정점부터 차례로 방문합니다."}
 ]'::jsonb
);
