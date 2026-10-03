# 문제은행 · 시험지 · 점수 · 예상 등수 UI

화면 이름의 목표는 소문자 `passfinder`다. UI 담당자가 적용하며 현재 문서·서버 작업에서는 UI 파일을 수정하지 않는다. 실제 외부 주소와 기존 브라우저 저장 키는 유지하며 명칭 변경으로 저장된 학습 기록을 잃지 않게 한다.

제출 진입점은 `/study/make.html`의 실제 AI 학습 흐름이다. `/`의 기존 교안 업로드 화면에도 해당 링크를 제공한다. 기존 업로드·목록·샘플 문제은행 경로는 유지하며 첫 화면에서 다음 행동을 찾을 수 있게 한다. Next.js 통합본은 별도 브랜치에서 검증하며 현재 Express 실행을 대체하지 않는다.

## 현재 범위

사용자가 요청한 네 영역을 기존 Express MVP와 분리된 프론트엔드 체험 화면으로 구현했다. **DB 연결 완료나 실서비스 채점 완료를 뜻하지 않는다.** 샘플 8문항 외 실제 문제·학생·응시 결과를 읽거나 저장하지 않는다.

- 현재 Express 실행: `npm start` → `http://localhost:3000/study/`
- 기존 `/` 교안 업로드, `/upload`, `/uploads`는 보존했다. 저장소 루트의 기존 `index.html`은 수정하지 않았다.
- `public/exam-workspace/`는 프레임워크 독립 정적 HTML/CSS/ES module이다. 서버 변경은 정적 경로 등록 1개다.
- 의존성 추가, DB 쓰기, 모델 호출, 로그인·보안 설정 변경, 수동 배포는 없다.
- 화면 전체에 샘플 모드와 세션 내 상태임을 표시한다. 시험지·점수는 메모리에만 있으며 새로고침하면 사라진다. 브라우저 저장소에도 기록하지 않는다.

## 동작하는 체험 흐름

1. 문제 내용/개념 검색, 개념·난이도 필터, 문항 선택/해제
2. 선택한 문제로 이름 있는 시험지 생성. 선택 중복과 빠른 중복 제출 방지
3. 모든 문제에 응답해야 제출 가능. 메뉴로 나갔다가 동일 세션에서 이어 풀기
4. 객관식 샘플 정답 일치로 문항당 10점 채점, 점수·정답 수·문항별 해설·세션 풀이 기록 표시
5. 다시 풀면 새 시도. 완료한 결과를 중복 기록하지 않음
6. 예상 등수는 `표본 부족`, 관측 등수는 `집계 대기`, 실제 비교 표본은 `0명`. 체험 점수는 실제 비교 집단에 포함하지 않음

새로고침으로 세션이 초기화되거나 존재하지 않는 화면 hash로 들어오면 안전한 빈 상태를 표시한다. 한글 IME 조합 중 검색 입력을 다시 렌더링하지 않는다.

## API-facing DTO 제안

이하 DTO는 DB 준비 작업과 맞춘 **연결 계약 제안**이며 아직 구현된 HTTP API가 아니다. 기존 PR #4의 문항/과목 구현과 연동할 때 단일 서버 API를 연결한다. 임의의 별도 저장소나 DB 테이블을 UI에서 생성하지 않는다.

```ts
type ExamPaper = {
  id: string; title: string; courseId: string; version: number;
  status: 'draft' | 'published'; questionCount: number;
  maxScore: number; durationMinutes: number | null;
};
type ExamResult = {
  attemptId: string; examId: string; examVersion: number;
  score: number; maxScore: number; correctCount: number;
  questionCount: number; submittedAt: string;
};
type Ranking = {
  status: 'insufficient_data' | 'observed' | 'estimated';
  observedRank: number | null; cohortSize: number | null; sampleSize: number;
  estimatedRank: number | null; lowerRank: number | null; upperRank: number | null;
  method: string | null; calculatedAt: string | null;
};
```

현재 샘플에서만 시험지에 `questionIds/createdAt`, 결과에 `details`를 덧붙인다. 공개 응시 화면의 문항은 정답·해설을 포함하지 않는 DTO로 분리해야 한다. `demo-data.mjs`에 정답이 들어 있는 이유는 공개 체험 문제이기 때문이며, **실제 시험에 이 파일 형태나 브라우저 채점 함수를 사용하면 안 된다.** 서버에서 답안을 검증·채점하고, 제출 성공 이후에만 정답·해설을 반환한다.

- 관측 등수: 동일 `examId + examVersion`, 동일 문항·배점의 비교 가능한 응시자만 집계. 재응시 포함 기준, 동점 처리 규칙은 서버 계약에서 명시
- 예상 등수: 표본 수, 모집단 크기, 추정 방법/버전, 범위, 계산 시각을 함께 제공. 점수만으로 임의 추정 금지
- `domain.mjs`의 `rankingView`는 위 근거가 빠지거나 숫자 범위가 모순되면 추정을 숨긴다. 현재 화면은 명시적인 `insufficientRanking()`만 사용
- 최소 표본 수와 통계적 타당성은 아직 결정되지 않았다. `rankingView`의 숫자 검사 자체가 통계적 검증을 의미하지 않는다
- 서버 저장 전후에는 인증·과목 참여 권한, 버전 고정, 중복 제출 idempotency, 입력 검증, 401/403·서버 오류·문항 부족 상태를 검증해야 함

## 교안으로 객관식 5문제 만들기(FR-12, 2026-10-03 14:25 추가)

샘플 화면은 그대로 두고, 실제 AI 흐름은 `/study/make.html`(`make.mjs`)에 따로 만든다. 왼쪽 메뉴에 "교안으로 문제 만들기" 링크 한 줄만 더한다. 학생은 개인 AI 계정·API 키·MCP 없이 쓴다.

흐름: PDF 선택 → 브라우저에서 쪽별 글자 추출(pdf.js) → 시작·끝 쪽 선택 → "문제 5개 만들기" → 서버가 학교 AI로 생성 → 서버 검사 → 통과 5문항 표시 → 풀이 → 채점·결과 저장 → 오답 복습.

| 상태 | 화면 | 다음 행동 |
|---|---|---|
| 자료 없음 | 파일 선택, "샘플로 체험" | PDF 고르기 |
| 글자 읽는 중 / 읽기 실패 | 진행 문구 / "글자를 읽을 수 없어요" | 다른 PDF |
| 범위 선택 | 파일명·쪽 수, 시작·끝 쪽(기본 1~최대 5쪽) | "문제 5개 만들기"(이미 만든 범위면 "저장된 문제 열기") |
| 생성 중 | 버튼 비활성, "학교 AI가 문제를 만드는 중이에요(최대 1분)" | 기다리기 |
| 생성 실패 | 사유와 "다시 시도". 파일·범위 유지 | 다시 시도, 범위 줄이기 |
| 풀이 | 5문항, 표시: "학교 AI 생성 · 모델 · 시각" 또는 "샘플(AI 호출 없음)" | 모두 답한 뒤 제출 |
| 결과 | 점수, 문항별 정오·정답·해설·근거 쪽과 근거 문장 | "오답 복습" |

API 계약 `POST /api/generate`
- 요청: `{ title, range: {from, to}, pages: [{page, text}], count: 5 }`. 고른 범위의 글자만 보낸다. 최대 20쪽·40,000자.
- 200: `{ ok: true, source: "school-ai", model, generatedAt, questions: [{ id, body, choices[4], answerIndex, explanation, evidence: {page, quote} }], rejectedCount }`
- 422 `not_enough_valid`(검사 통과 5개 미만, 통과 수 포함), 503 `ai_not_configured`(서버에 `KOOKMIN_KEY` 없음), 502 `ai_failed`, 504 `ai_timeout`, 400 `invalid_input`. 실패 응답에는 문항을 넣지 않는다.

서버 검사(통과한 문항만 응답에 넣는다)
- 선택지 정확히 4개, 빈 칸·중복 없음, 정답 번호 0~3, 문제 8자 이상, 해설 있음
- 근거 쪽이 고른 범위 안이고, 근거 문장(공백 무시 10자 이상)이 그 쪽 글자에 그대로 들어 있음
- 같은 문제 문장 중복 제거. 첫 호출에서 7개를 받고, 5개가 안 되면 부족분만 한 번 더 요청한다. 그래도 모자라면 422.

저장과 중복 방지
- 이 브라우저의 localStorage에 저장한다: 자료(`pf.make.materials`), 생성 묶음(`pf.make.sets`, 키 = 자료 해시 + 범위), 풀이 기록(`pf.make.attempts`). 새로고침 뒤에도 남고, 같은 자료·범위는 서버를 다시 부르지 않는다. 생성 문제와 전체 풀이 결과는 본인 Supabase에도 저장한다. 참가자 토큰을 지우면 목록을 다시 찾을 수 없으며 카카오 계정과의 동기화는 아직 없다. 서버 계약과 검증 결과는 [API 계약](api-contract.md)의 공유 시험 절을 따른다.
- 풀이 중에는 답을 선택할 때마다 마지막 화면 기록(`pf.make.last`)에 답안을 함께 저장한다. 새로고침하면 같은 문제 묶음과 전체 풀이 또는 오답 복습 상태, 선택한 답을 복원한다. 과목별 저장 키 구분은 유지한다. 기존 기록에 답안이 없으면 미응답으로 연다.
- 복원할 답은 현재 풀이의 문항 ID와 선택지 범위에 맞는 정수만 인정한다. ‘처음부터 다시 풀기’와 새 오답 복습은 빈 답안으로 시작한다. 제출 완료 결과는 기존 풀이 기록에서 복원하며 새로고침으로 기록을 추가하지 않는다.
- 저장에 실패하면 현재 화면의 풀이를 유지하고 ‘답안을 이 브라우저에 저장하지 못했어요. 새로고침하면 선택한 답이 사라질 수 있어요.’라고 알린다. 완료 결과와 마지막 화면 기록의 저장을 확인한 경우에만 ‘저장됨’을 표시한다. 완료 결과 저장에 실패하면 다음 접속에서 답안을 복원하며 이전 완료 결과를 이번 결과처럼 표시하지 않는다. 그 화면에서 복습하면 현재 결과의 오답을 사용한다.
- 이 수정은 FR-12의 기존 저장·복습 흐름에 대한 오류 수정이다. 제출 PRD, AI 생성 방식, 샘플 문제은행은 유지한다. 생성 문제의 저장·채점에는 기존 공통시험 API를 연결한다. 담당은 Codex이며 로컬 자동 검사와 브라우저 확인 뒤 통합할 수 있다. 배포는 별도 승인 범위다.
- 브라우저: 요청 중 버튼 비활성 + 같은 키의 진행 중 요청 재사용. 서버: 같은 내용의 동시 요청은 한 번만 학교 AI를 부른다(같은 서버 인스턴스 안).
- 키는 서버 환경 변수로만 읽고 응답·로그에 넣지 않는다.

## Next.js / PR #4로 이어가는 방법

이 작업은 Express를 최종 아키텍처로 확정하지 않는다. PR #4가 팀의 기준 구현으로 채택되면 다음 순서로 재사용한다.

1. `public/exam-workspace/` 디렉터리를 그대로 보존하면 Next.js에서도 `/exam-workspace/index.html`로 정적 체험 화면을 열 수 있다. Express의 `/study` middleware는 Next.js 서버로 옮기지 않는다.
2. 기존 `app/courses/[id]/`와 `components/StageMap.tsx` 담당자와 동선을 합의한다. 필요하면 체험 링크만 추가하며 기존 화면을 덮어쓰지 않는다.
3. `bankPage/papersPage/takePage/resultsPage/rankingPage`의 구획을 React 컴포넌트로 옮기고 `domain.mjs`의 표시 로직/회귀 테스트를 재사용한다. 전역 CSS는 해당 layout 또는 CSS module로 범위를 좁힌다.
4. 실제 과목의 문제은행 조회, 시험지 생성/조회, 시도 제출/결과 조회를 기존 `lib/api-client.ts`의 인증/오류 처리 체계에 맞춘다. 브라우저에서 서비스 키를 읽거나 Supabase 관리자 클라이언트를 직접 호출하지 않는다.
5. 샘플 데이터와 실제 데이터 adapter를 명시적으로 분리하고, 실제 API 계약·테이블·권한 테스트를 통과한 화면에서만 샘플 배너를 제거한다. 추정이 미연결이면 예상 등수는 계속 `표본 부족/계산 전`으로 둔다.
6. UI를 실서비스로 전환하기 전에 아래 미실행 브라우저 및 실제 DB 통합 검증을 완료한다.

## 검증

실행 환경: Node 24.19.0. 2026-10-03에 수행했다.

```sh
node --check server.js
node --check public/exam-workspace/app.mjs
node --test tests/exam-workspace/domain.test.mjs tests/exam-workspace/http.test.mjs
```

- 단위 테스트 9개 통과: 교차 필터, 선택 중복, 0번 답안, 만점/0점, 미응답·잘못된 답 거부, 표본 부족, 관측/추정 분리, 추정 근거 누락, HTML escaping
- HTTP 테스트 1개 통과: `/`와 `/study/`, slash redirect, 4개 정적 asset의 MIME·본문, 없는 asset 404, 기존 PDF 업로드·목록·다운로드, 잘못된 MIME·미첨부 400
- DOM 회귀 테스트 4개 통과: 검색/필터/IME/빈 상태, 제목 XSS escape, 중복 시험지 생성 방지, 풀이 중단·재개, 미응답 거부, 중복 제출 방지, 새 시도·세션 초기화

DOM 테스트는 production dependency 없이 별도 설치한 `jsdom@30.1.1`로 실행했다. 필요하면 별도 임시 경로에 설치하고 모듈 경로를 지정할 수 있다.

```sh
npm install --prefix /tmp/alttab-ui-testdeps --package-lock=false jsdom@30.1.1
JSDOM_MODULE=/tmp/alttab-ui-testdeps/node_modules/jsdom/lib/api.js \
  node --test tests/exam-workspace/dom.test.mjs
```

### 미실행 · 제한

답안 저장·복원 수정의 로컬 검증은 다음과 같다. 기존 배포·AI 품질 검증과 구분한다.

- `make-recovery.test.mjs`의 9개 검사 통과: 일반 풀이·오답 복습 답안 복원, 과목 분리, 다시 풀기 초기화, 완료 결과 중복 방지, 잘못된 저장 답안 제외, 이전 저장 형식 호환, 저장 실패 안내, 이전 결과 오인 방지.
- 기존 도메인 9개·문제은행 DOM 4개·HTTP 1개를 합쳐 23개 통과. Windows 줄바꿈에서도 기존 DOM 검사에서 모듈 구문을 제거하도록 시험 도구를 수정했다. 서비스 의존성은 추가하지 않았다.
- 로컬 Chrome의 `/study/make.html`에서 샘플 두 문항 선택 후 새로고침, 4/5 채점, 오답 한 문항 복습 후 새로고침을 직접 확인했다. 선택한 답과 제출 가능 상태가 유지됐다.
- 실제 AI 호출, 운영 DB 기록, 공개 배포는 실행하지 않았다. 답안 저장 실패는 DOM 시험에서 저장소 쓰기 실패를 주입해 확인했다. 모델 정확도 개선을 입증하는 검사는 아니다.

```powershell
$env:JSDOM_MODULE='file:///C:/work/tmp/passfinder-test-tools/node_modules/jsdom/lib/api.js'
node --test tests/exam-workspace/domain.test.mjs tests/exam-workspace/make-recovery.test.mjs tests/exam-workspace/dom.test.mjs tests/exam-workspace/http.test.mjs
```

아래는 화면 전체와 서비스 통합에 남은 검증이다.

- 화면 전체의 모바일 레이아웃 검증은 미실행. 이전 로컬 Chromium 검사는 컨테이너 socket 생성 제한으로 시작 실패했고 별도 클라우드 브라우저는 localhost 접근을 `ERR_BLOCKED_BY_CLIENT`로 거절했다. 답안 복원 검증은 로컬 Chrome에서 별도로 수행했다.
- DOM 테스트는 layout, 실제 키보드 focus/history, 접근성 대비, 브라우저 모듈 로딩을 보장하지 않는다. 실제 브라우저에서 390px·768px·1440px 폭, 가로 overflow, 검색 IME, radio 키보드, Back/Forward, 중단/재개, 새로고침을 확인해야 한다.
- 실제 Supabase 공통시험 저장·서버 채점·재조회는 API 계약의 검증 기록을 따른다. 수정 화면의 공개 배포, 등수 추정과 Vercel 실환경 파일 서빙은 미검증이다.
- 기존 프로젝트에 별도 lint/build 명령은 없다. 이 정적 UI에 번들러나 build script를 추가하지 않았다.

AI 사용: OpenAI Codex가 요청된 UI·테스트·통합 안내를 작성했다. 사용자 요청에 따른 최신 협업 방식으로 제출하며 사전 검토/승인을 대신 주장하지 않는다.
