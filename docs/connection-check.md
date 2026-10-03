# DB / LLM 연결 시연

화면: `/mock/` (기존 `/`, `/study/`, 문제 생성·시험 API는 유지)

1. 테스트 문장 입력 → **저장하고 읽어오기** → Supabase에 쓴 뒤 별도 GET으로 같은 값을 읽어 정확히 일치하는지 표시한다.
2. DB 확인 후 짧은 문장 입력 → **AI에 1회 보내기** → 학교 AI의 실제 텍스트 응답을 표시한다.

샘플 응답이나 로컬 저장을 실제 연결 성공으로 표시하지 않는다. 키가 있다는 서버 상태와 실제 저장·읽기/AI 응답 성공은 별개다.

## 서버 설정

- 기존 서버 환경 변수 `SUPABASE_KEY`: 서버 전용 Supabase 키. 브라우저·로그·오류 응답에 전달하지 않는다.
- 기존 서버 환경 변수 `KOOKMIN_KEY`: 학교 AI 키. 서버에서만 읽는다.
- 대상 DB는 `https://ltxuvtunctrayeewbwyd.supabase.co`로 고정한다. `SUPABASE_URL`이 있으면 이 주소와 정확히 일치해야 한다.
- 학교 API는 `https://ai.cs.kookmin.ac.kr/v1/messages`, `x-api-key`, `anthropic-version: 2023-06-01`로 고정한다. 모델은 `claude-haiku-4-5`다.
- 새 자격 증명·로그인 계정·Vercel 보안 설정을 만들거나 변경하지 않았다.

## 승인된 공개 시연 범위

- 로그인 없이 접근하는 공개 시연이다. 다른 방문자가 문장을 덮어쓰거나 1회 AI 호출권을 먼저 사용할 수 있다. Origin 검사는 인증 수단이 아니다.
- 입력은 200 Unicode 코드 포인트 및 UTF-8 800바이트 이하. 개인 정보·비밀번호·키를 입력하지 않는다.
- DB는 `public.alttab_connection_test`의 고정된 한 행만 덮어쓴다. 다른 테이블·행 목록·SQL·URL을 입력받지 않는다.
- LLM은 **전체 서버 인스턴스를 합해 1회**다. DB의 `llm_claimed_at IS NULL` 조건부 PATCH로 먼저 원자적으로 호출권을 사용한다. 동시 요청, 새로고침, 서버 재시작으로 복구되지 않는다.
- DB 문장을 다시 저장해도 `llm_claimed_at`을 변경하지 않는다. 공급자 실패·시간 초과처럼 실제 과금 여부가 불확실해도 호출권을 복원하거나 자동 재시도하지 않는다.
- AI 출력은 최대 32토큰. 임의 모델·도구·대화 기록·프록시 옵션은 허용하지 않는다.
- **2026-10-03 20:00 KST에 DB 쓰기와 AI 호출을 종료**한다. DB 요청 뒤에도 외부 요청 직전 시간을 다시 확인한다. 화면/설정 상태 확인은 계속 가능하다.
- 추가 AI 호출권이나 종료 시각 변경은 별도 확인 없이 하지 않는다.

학교 모델 요금표는 로그인 화면으로 연결되어 실제 과금 단가·최소 요금·배율은 확인하지 못했다. 토큰/호출 수 제한을 달러 금액의 강제 상한이라고 주장하지 않는다. 실제 유료 호출은 이 구현 검증에서 실행하지 않았다.

## API

동일 사이트 Origin, POST, JSON만 허용한다. query parameter와 임의 body 필드는 받지 않는다. 본문 2KB, DB 요청 8초, LLM 요청 25초 제한. 리다이렉트를 따라가지 않는다. 외부 응답 원문·키·예외 원문을 기록/반환하지 않는다.

- `POST /api/mock/status {}`: 환경 변수 존재 여부·시연 종료 여부. 실제 DB/AI 연결 성공을 뜻하지 않는다.
- `POST /api/mock/db {"value":"테스트 문장"}`: 고정 행 upsert 후 별도 read. 일치할 때만 `source: "supabase", saved: true, read: true, exactMatch: true`.
- `POST /api/mock/chat {"message":"짧은 질문"}`: DB 호출권 claim 후 실제 학교 API 호출. 실제 텍스트만 `source: "school-ai"`로 반환한다.

## 격리된 테이블

2026-10-03 사용자 승인으로 `create_alttab_connection_test` 마이그레이션을 적용했다. 기존 데이터/테이블은 변경하지 않았다.

```sql
CREATE TABLE public.alttab_connection_test (
  id boolean PRIMARY KEY DEFAULT true CHECK (id = true),
  value text NOT NULL CHECK (char_length(value) BETWEEN 1 AND 200),
  updated_at timestamptz NOT NULL DEFAULT now(),
  llm_claimed_at timestamptz
);
ALTER TABLE public.alttab_connection_test ENABLE ROW LEVEL SECURITY;
```

RLS 정책은 만들지 않아 공개/일반 사용자 키로 행을 읽거나 쓸 수 없다. 서버 역할의 SELECT/INSERT/UPDATE 권한과 익명 조회 0행을 확인했다. Supabase 보안 advisor의 `RLS Enabled No Policy` 정보 항목 1건은 이 서버 전용 설계에 따른 것이다. 키는 연결 도구로 가져오거나 복사하지 않았다.

## 검증 결과

Node 24.19.0. production dependency 추가 없음. 기존 저장소에 lint/build 명령 없음.

```sh
node --check server.js
node --check connection-check.js
node --check public/connection-check/app.js
node --test tests/connection-check.test.cjs
JSDOM_MODULE=/tmp/alttab-ui-testdeps/node_modules/jsdom/lib/api.js \
  node --test --test-concurrency=1 tests/connection-check.test.cjs \
  tests/connection-check-dom.test.mjs tests/exam-workspace/*.test.mjs
```

- 신규 서버 테스트 11개: 분리된 쓰기/읽기, 정확 일치 실패, 키 없음/다른 DB 차단, 다중 인스턴스 1회 claim, 저장 시 claim 유지, 공급자 실패/비밀 삭제, DB/키 선행 조건, 종료 경계, Origin/메서드/JSON/본문 제한, 정적 파일/CSP, 오류 처리
- 신규 DOM 테스트 4개: DB 다음 LLM 순서, 연타 방지, HTML을 텍스트로 출력, 입력 보존/실패, 키 없음/종료, LLM 실패 자동 재시도 없음
- 기존 시험 화면 도메인/HTTP/DOM 테스트 14개. 병렬 실행에서 기존 12ms hash-navigation 테스트 1건이 타이밍 실패했으며 순차 재실행은 모두 통과했다.
- 실제 Supabase 연결 도구 경로에서 테스트 문장 저장/읽기 정확 일치 확인, RLS 활성화/정책 0개/익명 조회 0행 확인
- 2026-10-03 15:01 KST: [배포된 /mock/](https://alt-tab-mu.vercel.app/mock/)에서 서버 키 존재와 실제 DB 저장·별도 읽기·값 정확 일치를 확인했다. `AltTab Vercel DB 테스트 2026-10-03` 입력과 DB 직접 조회가 일치했으며 클라우드 브라우저 화면도 확인했다. 구현 커밋 `ec458ca`의 Vercel 상태는 success다.
- LLM은 실제 학교 요금 상한을 확인하지 못해 미실행이다. 15:01 KST에 전역 1회 호출권이 미사용임을 확인했다. 단위 테스트의 provider stub은 실호출 성공 증거가 아니다.
- 전체 순차 테스트 29개 통과. Preview/Development 설정과 다른 앱 기능의 DB 전환은 이 검증에 포함하지 않는다.

공식 프로토콜: [학교 AI](https://ai.cs.kookmin.ac.kr/), [학교가 연결한 New API Messages 문서](https://docs.newapi.pro/en/docs/api/ai-model/chat/createmessage).

구현·검증: OpenAI Codex. 최신 main의 팀원 변경을 보존하고 일반 fast-forward 갱신으로 제출한다.
