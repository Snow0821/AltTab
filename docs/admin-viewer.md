# 공개 데이터 조회 화면

- 화면: `/admin/`
- 테이블 목록: `GET /api/admin/tables`
- 저장 행 조회: `GET /api/admin/tables/alttab_connection_test?page=1`

로그인 없이 DB의 공개 테스트 데이터를 읽는 화면이다. 수정·삭제·SQL 실행·내보내기 기능은 없다. 서버의 기존 `SUPABASE_KEY`를 사용하며 새 키, 계정, 권한, RLS 정책 또는 Vercel 설정을 만들거나 변경하지 않는다.

2026-10-03 사용자 요청으로 일반 테스트 문장을 그대로 표시하도록 수정했다. 최초 구현의 단일 샘플 문자열 제한은 제거했다. `/mock`과 `/admin`은 동일 프로젝트·테이블·고정 행을 사용한다. 입력값이 안 보이던 원인은 DB 연결 문제가 아니라 최초 공개 화면의 전체 가림 처리였다.

## 실제 확인한 저장 범위

연결 대상은 소유자가 확인한 Supabase 프로젝트 `nwatlpkwenucgyexeopz`다. 조회 대상은 `alttab_connection_test` 한 개로 제한하며 다른 학습 테이블을 공개하지 않는다. RLS 활성화, 단일 행 구조(`id = true`)이며 `id`, `value`, `updated_at`만 선택해서 읽는다. 내부 LLM 사용 기록 컬럼은 조회하지 않는다.

현재 확인된 값은 `안녕 AltTab! DB 연결 테스트`, 마지막 저장 시각은 `2026-10-03T06:02:55.959Z`였다. 이 내용은 스키마/저장 데이터 확인 시점의 증거이며 화면에 하드코딩된 성공 응답이 아니다. 화면의 연결 상태·행·조회 시각은 실제 서버 GET 성공 후에만 표시한다.

학습 문제·풀이 기록은 현재 브라우저 저장소에 있고, 기존 PDF 업로드는 서버 저장소(Vercel에서는 임시 저장소)를 사용한다. 해당 데이터가 Supabase에 저장된 것처럼 표시하지 않는다.

## 공개 범위와 보호 장치

- 조회 대상 프로젝트·테이블·컬럼·정렬 순서를 서버 코드에 고정한다. 클라이언트가 URL·테이블·컬럼·SQL을 고를 수 없다. 알 수 없는 경로와 query 필드는 거절한다.
- 일반 테스트 문장은 원문으로 표시한다. 사용자 승인 범위는 이 테스트 테이블의 입력값이다. 개인정보나 비밀값을 입력하지 말라는 공개 안내를 표시한다.
- 서버가 설정된 키와 정확히 일치하는 문자열, 알려진 토큰/키 형식, Bearer 토큰, 비밀번호·키 대입 구문, 비밀번호 포함 연결 URL, private-key PEM을 감지하면 해당 부분만 `[비밀값 숨김]`으로 바꾼다. 이때 `valueRedacted: true`를 반환한다. 이 탐지는 모든 비밀값이나 개인정보를 식별한다고 보장하지 않는다.
- 신규 테이블·컬럼은 자동으로 공개하지 않는다. 추가 전에 데이터 분류와 공개 범위를 검토해야 한다.
- upstream 요청은 GET만 사용한다. 공개 API는 GET/HEAD만 허용하며 POST/PUT/PATCH/DELETE를 405로 거절한다.
- 페이지 크기 25, 페이지 1~100 제한. 실제 테이블은 최대 1행이라 다음 페이지는 비활성화된다. 스키마의 단일 행 제약과 다른 응답은 거절한다.
- 서버 요청 시간 제한 8초, 브라우저 요청 시간 제한 12초, 응답 본문 제한 16KB, 리다이렉트 차단. 키·공급자 오류 원문·예외 원문은 반환하거나 기록하지 않는다.
- 브라우저는 DOM `textContent`로만 값을 표시한다. CSP, `no-store`, `nosniff`, `no-referrer`, `noindex`를 설정한다. `noindex`는 접근 통제가 아니며 이 페이지는 공개다.
- 자동 새로고침·자동 재시도·유료 AI 호출은 없다. 사용자가 누른 새로고침만 수행하고 진행 중 연속 클릭을 막는다.

## 검증

Node 24.19.0. production dependency 추가 없음. 현재 저장소에는 별도 lint/build 스크립트가 없다.

```sh
node --check server.js
node --check admin-viewer.js
node --check public/admin/app.js
NODE_PATH=/path/to/installed/node_modules \
JSDOM_MODULE=/path/to/jsdom/lib/api.js \
node --test --test-concurrency=1 tests/admin-viewer.test.cjs \
  tests/admin-viewer-dom.test.mjs tests/connection-check.test.cjs \
  tests/connection-check-dom.test.mjs tests/exam-workspace/*.test.mjs
```

- 새 API 테스트 11개: 고정 GET/선택 컬럼, server-only 키, 임의의 일반 테스트 문장 원문 표시, 비밀값 부분 가림, query/경로/페이지 제한, 쓰기 차단, 설정 누락/다른 프로젝트 차단, JWT/opaque 키 헤더 구분, 오류 비밀 제거, 크기/응답 형식/스키마 변화 차단, 빈 DB, CSP/정적 파일 노출 범위
- 새 DOM 테스트 5개: 실제 응답 기반 표시/KST, 연타 방지, HTML 텍스트 처리, 가림 처리, 빈 데이터, 오류/네트워크 실패/수동 재시도, 이전/다음 페이지, 브라우저 요청 시간 초과 후 제어 복구
- 최초 구현은 순차 테스트 44개를 통과했다. 일반 테스트 문장 표시 수정 후에는 새 화면/API 16개와 최신 연결 테스트 15개, 총 **31개 통과**를 확인했다. 기존 시험 화면은 이번 수정에서 바꾸지 않았다.
- 별도 보안 검토에서 공개 범위·키 비노출·읽기 전용·실패 처리 확인
- 로컬 cloud-browser 시각 검증은 `ERR_BLOCKED_BY_CLIENT`로 차단됐다. DOM/HTTP 검증과 실 서비스 배포 뒤 확인은 구분한다.
- 이 테스트 실행은 mock provider를 사용하며 실제 LLM 호출이나 DB 쓰기는 하지 않았다. 실제 Supabase 스키마·기존 행은 읽기 전용 연결 도구로 별도 확인했다.

구현·검증: OpenAI Codex. 최신 main을 기준으로 지정 파일만 일반 fast-forward 갱신하며 팀원의 동시 변경을 보존한다.

공식 참고: [Data API 조회/선택/정렬](https://supabase.com/docs/guides/api/sql-to-api), [서버 역할](https://supabase.com/docs/guides/database/postgres/roles), [범위 조회](https://supabase.com/docs/reference/javascript/range).
