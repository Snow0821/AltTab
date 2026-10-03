# DB · LLM 테스트 사용법

화면: [AltTab 연결 테스트](https://alt-tab-mu.vercel.app/mock/)

## 사용하는 순서

1. **테스트 값**에 문장을 입력하고 **저장하고 읽어오기**를 누릅니다.
2. `저장 ✓ 읽기 ✓ 정확히 일치 ✓`와 돌아온 문장을 확인합니다.
3. **AI에게 보낼 짧은 문장**에 질문을 입력하고 **AI에 보내기**를 누릅니다.
4. 답변·모델·입출력 토큰 수를 확인합니다. 답변이 끝나면 다른 문장으로 다시 테스트할 수 있습니다.

새로고침했다면 DB 버튼부터 다시 누르면 됩니다. DB에는 가장 최근 테스트 문장 한 개가 남습니다.

현재 1회 사용 잠금은 제거했습니다. 코드에 남아 있는 시연 종료 시각은 **2026-10-03 20:00 KST**이며, 이후에도 이어서 쓸 때는 아래 `DEMO_END`를 변경하면 됩니다.

## 서버 환경 변수

Vercel 프로젝트의 기존 서버 환경 변수를 사용합니다.

- `SUPABASE_SECRET_KEY` 또는 `SUPABASE_SERVICE_ROLE_KEY` 또는 `SUPABASE_KEY`: 본인 프로젝트의 서버 전용 키
- `KOOKMIN_KEY`: 학교 AI 키
- `SUPABASE_URL`: `https://nwatlpkwenucgyexeopz.supabase.co`. 다른 프로젝트로 연결하지 않는다.

## 연결 정보

- DB: `public.alttab_connection_test`
- 스키마: [connection-check.sql](../supabase/connection-check.sql). 본인 프로젝트에 별도로 생성하며 다른 프로젝트의 데이터는 옮기거나 지우지 않는다. RLS를 켜고 공개 정책 없이 서버만 접근한다.
- 필드: `id` (고정 true), `value` (테스트 문장), `updated_at` (저장 시각), `llm_claimed_at` (이전 1회 테스트 기록; 지금은 잠금에 사용하지 않음)
- AI: `POST https://ai.cs.kookmin.ac.kr/v1/messages`
- 모델: `claude-haiku-4-5`
- API: `POST /api/mock/status`, `POST /api/mock/db` (`value`), `POST /api/mock/chat` (`message`)

## 이어서 수정할 파일

- `connection-check.js`: DB 저장/읽기와 AI 호출. `DEMO_END`는 종료 시각, `MODEL`은 모델, `MAX_TEXT_CHARS`와 `MAX_OUTPUT_TOKENS`는 입력·응답 길이
- `public/connection-check/index.html`: 화면 문구와 입력 폼
- `public/connection-check/app.js`: 버튼 동작과 결과 표시
- `public/connection-check/styles.css`: 화면 스타일
- `tests/connection-check.test.cjs`, `tests/connection-check-dom.test.mjs`: 서버·화면 회귀 테스트

## 새 테이블이 필요할 때

팀원이 필요한 내용을 프로젝트 담당자나 민트에게 전달하면 됩니다.

- 테이블 이름과 용도
- 컬럼 이름·자료형·필수 여부·예시 값
- 누가 읽고 쓸 수 있어야 하는지
- 기존 테이블과 연결되는 항목

민트가 기존 테이블과 요청 범위를 확인한 뒤 생성안을 준비하고 필요한 승인에 맞춰 반영합니다.

## 확인된 결과

- 2026-10-03 15:01 KST: 배포 화면에서 `AltTab Vercel DB 테스트 2026-10-03` 저장·별도 읽기·값 일치 확인
- 15:08 KST: `Reply only: OK` → 실제 AI 답변 `OK`, 모델 `claude-haiku-4-5`, 입력 11 / 출력 4토큰
- 잠금 해제 후 반복 동작은 모의 응답 회귀 테스트로 검증. 추가 유료 호출은 하지 않음

[상세 연결 점검 기록](supabase-vercel-connection-status.md)
