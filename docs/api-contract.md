# API 계약 — 점수·랭킹·학습·이용권·공유 시험

이 문서는 Express `server.js`에 실제로 구현된 API 중 **점수/랭킹, 시험 출제/채점, 이용권, 공유 시험(FR-13~15)** 엔드포인트를 기록합니다. 코드 기준 작성이며, 문항 생성(`/api/generate`)은 담당자가 별도로 문서화합니다. UI 담당자는 아래 [공유 시험·결과 비교·풀이 참고](#공유-시험결과-비교풀이-참고-fr-13-15--ui-연결-명세) 절의 연결 순서를 따릅니다.

- 기준 커밋: `main` (2026-10-03) + 브랜치 `feat/common-exam-db`
- 관련 모듈: `scores.js`, `exam.js`, `entitlements.js`, `participants.js`, `shared-store.js`
- 공통 성공 형식: `{ "ok": true, ... }`
- 공통 오류 형식: `{ "ok": false, "error": "메시지", "code": "선택적_코드" }`
- 저장: 점수는 `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`가 없으면 `uploads/*.json` 로컬 폴백입니다. 공유 시험·응시는 `shared-store.js`가 Supabase(`SUPABASE_SERVICE_ROLE_KEY`·`SUPABASE_SECRET_KEY`·`SUPABASE_KEY` 중 하나) 또는 개발용 로컬 JSON에 저장하며, 응답의 `storage` 값(`"supabase"`/`"local"`)으로 구분합니다. 로컬 JSON은 Vercel 재배포 때 사라집니다.

> 사용자 식별: 점수·스테이지·이용권 API의 `userId`는 요청 본문/쿼리 값을 그대로 사용합니다(임의 값 신뢰 금지, 통합 시 교체 필요). **공유 시험 API는 서버가 발급한 참가자 토큰(`X-Participant-Token`)으로만 본인을 확인합니다.**

---

## 점수 / 랭킹 (`scores.js`)

### POST /api/scores
점수 1건 저장. 저장 성공 시 SSE 구독자에게 최신 랭킹을 브로드캐스트합니다.

요청 본문:
```json
{ "playerName": "홍길동", "score": 90, "quizId": "q1" }
```
- `playerName`: 1~40자, 필수
- `score`: 0~1000000 정수, 필수
- `quizId`: 문자열, 선택

응답 `201`:
```json
{ "ok": true, "record": { "id": 1, "player_name": "홍길동", "score": 90, "quiz_id": "q1", "created_at": "2026-10-03T05:16:16.413Z" } }
```
오류: 입력 검증 실패 `400`.

### GET /api/leaderboard?limit=20
점수 내림차순 랭킹. 동점은 먼저 기록한 순. `limit` 기본 20, 최대 100.

응답 `200`:
```json
{ "ok": true, "mode": "local", "leaderboard": [ { "id": 1, "player_name": "홍길동", "score": 90, "quiz_id": "q1", "created_at": "..." } ] }
```
- `mode`: `"supabase"` 또는 `"local"`

### GET /api/leaderboard/stream  (SSE)
Server-Sent Events 스트림. 접속 즉시 현재 랭킹 1건을 보내고, 이후 점수가 저장될 때마다 최신 랭킹을 push합니다.

이벤트 데이터:
```
data: {"leaderboard":[ ... ]}
```
클라이언트 예:
```js
const es = new EventSource('/api/leaderboard/stream');
es.onmessage = (e) => { const { leaderboard } = JSON.parse(e.data); /* 렌더 */ };
```

---

## 시험 출제 / 채점 (`exam.js`)

정답(`answerIndex`)과 해설은 서버에만 둡니다. **출제 응답에는 정답/해설을 포함하지 않으며, 채점은 서버에서만** 수행합니다.

### POST /api/stages/:stageId/attempts
스테이지 출제. attempt를 생성하고 문제 5개를 반환합니다(정답/해설 제외). 이용권 접근 제한이 적용됩니다(아래 참고).

요청 본문:
```json
{ "userId": "u1", "courseId": "demo-data-structures" }
```
- `userId`: 선택(기본 `"anonymous"`)
- `courseId`: 선택(기본 `exam.COURSE.id`)

응답 `201`:
```json
{
  "ok": true,
  "attemptId": "uuid",
  "stageId": "stage-1",
  "examId": "demo-data-structures:stage-1",
  "examVersion": 1,
  "questionCount": 5,
  "questions": [ { "id": "demo-q1", "concept": "...", "difficulty": 1, "body": "...", "choices": ["..."], "qtype": "choice" } ]
}
```
오류:
- `404` 존재하지 않는 스테이지
- `403` `code: "payment_required"` — 무료 유닛을 넘는 스테이지인데 이용권 없음(응답에 `access` 포함)

### POST /api/attempts/:attemptId/answers
서버 채점. 같은 attempt를 다시 제출해도 XP/별 보상은 중복 지급되지 않습니다.

요청 본문:
```json
{ "answers": { "demo-q1": 1, "demo-q2": 2, "demo-q3": 1, "demo-q4": 0, "demo-q5": 1 } }
```
- `answers`: `{ [questionId]: choiceIndex }`. 모든 문항에 유효한 선택지가 있어야 합니다.

응답 `200`:
```json
{
  "ok": true, "attemptId": "uuid", "stageId": "stage-1",
  "examId": "demo-data-structures:stage-1", "examVersion": 1,
  "score": 50, "maxScore": 50, "correctCount": 5, "questionCount": 5,
  "passed": true, "stars": 3, "xpAwarded": 50, "alreadyGraded": false,
  "details": [ { "questionId": "demo-q1", "answer": 1, "correct": true, "answerIndex": 1, "explanation": "..." } ]
}
```
- `passed`: 5문제 중 4개 이상 정답
- `stars`: 만점 3, 통과(4+) 2, 절반 이상 1, 그 외 0
- `alreadyGraded`: 재채점 시 `true`, 이때 `xpAwarded`는 `0`

오류:
- `400` 답안 누락/범위 밖
- `404` 존재하지 않는 attempt

---

## 이용권 (`entitlements.js`, FR-06)

이용권이 없으면 첫 유닛(스테이지 5개)까지만 플레이할 수 있고, 6번째 스테이지(유닛 2)부터 이용권이 필요합니다. 결제는 **테스트(모의) 결제**이며 실제 금전 결제는 하지 않습니다.

### GET /api/courses/:courseId/access?userId=&stageUnit=
접근 판정.
- `stageUnit`을 주면 해당 유닛을 플레이할 수 있는지 판정합니다.
- `stageUnit`을 생략하면 과목의 이용권 보유 여부만 판정합니다.

응답 `200`:
```json
{
  "ok": true, "courseId": "demo-data-structures", "userId": "u1",
  "canPlay": false, "reason": "payment_required", "paymentMode": "test",
  "hasEntitlement": false, "entitlementType": null, "expiresAt": null, "freeUnitLimit": 1
}
```
- `reason`: `free_unit` | `entitled` | `payment_required` | `preview`

### POST /api/courses/:courseId/entitlements
테스트(모의) 결제로 이용권 발급.

요청 본문:
```json
{ "userId": "u1", "plan": "course_pass", "simulateFailure": false }
```
- `plan`: `course_pass`(과목 영구권) | `subscription`(30일 구독)
- `simulateFailure`: 테스트용 결제 실패 주입(선택)

응답 `201`:
```json
{ "ok": true, "entitlement": { "id": "uuid", "courseId": "...", "userId": "u1", "plan": "course_pass", "type": "permanent", "label": "과목 이용권", "price": 2900, "paymentMode": "test", "createdAt": "...", "expiresAt": null } }
```
- 구독(`subscription`)이면 `type: "subscription"`, `expiresAt`은 30일 뒤

오류:
- `409` `code: "already_entitled"` — 이미 유효한 이용권 보유(중복 구매 방지)
- `402` `code: "payment_failed"` — 모의 결제 실패
- `400` 지원하지 않는 plan / courseId 누락

---

## 검증 상태

로컬 폴백 모드에서 HTTP 통합 테스트로 아래를 확인했습니다(2026-10-03).
- 점수: 저장 201, 랭킹 내림차순/동점 순서, SSE 실시간 브로드캐스트
- 출제/채점: 출제 201(정답 미노출), 4/5 클리어·별·XP, 중복 보상 방지, 재도전, 400/404
- 이용권: 무료 유닛 통과, 6번째 차단 403, 모의 결제 201, 결제 후 해제, 중복 409, 실패 402, 사용자 격리, 구독 만료 경계

미검증: 실제 Supabase 연결과 다중 인스턴스 영속성(환경변수 필요).

---

## 공유 시험·결과 비교·풀이 참고 (FR-13~15) — UI 연결 명세

같은 문제 묶음을 저장해 공유 코드로 나누고, 서버가 채점한 결과를 같은 시험·버전 안에서만 비교하며, 제출자끼리 짧은 풀이를 참고합니다. 정답·해설은 제출 전에 브라우저로 가지 않습니다. 저장소: Supabase `shared_exams`·`shared_attempts`([정의](../supabase/shared-exams.sql), DB 소유자가 적용) 또는 개발용 로컬 JSON.

### 공통 규칙

- **참가자 토큰**: `POST /api/participants`로 한 번 발급받아 브라우저(localStorage, 예: `pf.participant`)에 보관하고, 이후 모든 공유 시험 요청에 헤더 `X-Participant-Token: <participantToken>`을 붙입니다. 토큰이 없거나 형식이 다르면 `401 participant_required`. 토큰을 지우면 새 참가자가 되므로 참가 수는 **익명 참가 기록 기준**입니다(실제 학생 수가 아님).
- 서버는 토큰에서 참가자 식별값을 계산합니다. 본문에 넣은 `participantId`·`score`·`userId`는 무시합니다.
- 식별자: `setId`(저장 1건) · `examId`(시험 묶음) · `examVersion`(고정 문항) · `shareCode`(링크용 8자, `[a-z2-9]`) · `attemptId`(응시).
- 집계 규칙: 참가자·시험·버전당 **첫 완료 응시만** 집계(`counted: true`, `countedReason: "first_completion"`). 이후 완료는 `"practice"`, 작성자 응시는 `"author"`로 집계 제외. 재전송은 저장된 결과를 그대로 돌려줍니다(`alreadyGraded: true`).
- 학생 풀이는 **일반 텍스트**입니다. 화면은 HTML로 해석하지 말고 텍스트 노드로 넣습니다(`textContent`). 채팅·댓글·좋아요는 없습니다.
- 오류 코드: `participant_required`(401) · `not_owner`(403, 남의 응시) · `not_author`(403, 작성자만 새 버전) · `not_submitted`(403, 제출 전 풀이 조회·작성) · `exam_not_found`/`attempt_not_found`(404) · `answers_incomplete`(400) · `solution_empty`/`solution_too_long`(400) · `invalid_question`(400) · `db_error`(502, DB 실패 — 성공으로 표시하지 말 것).

### 연결 순서 (생성 화면 `make.mjs` → 공유 → 비교)

1. 화면을 열 때 토큰이 없으면 `POST /api/participants` → `participantToken` 저장.
2. `POST /api/generate` 성공 뒤 **바로** `POST /api/question-sets`(토큰 포함)에 `{ title, source: "school-ai", questions: data.questions }`를 보냅니다. `201`로 `setId`·`shareCode`를 받은 뒤에만 완료 화면으로 갑니다. 실패(502 등)면 생성 결과를 localStorage에 그대로 두고 **"저장 다시 시도"**로 같은 본문을 재전송합니다(AI 재호출 없음). 연타·재전송해도 같은 참가자의 같은 세트는 같은 `setId`가 옵니다(`reused: true`).
3. 공유 링크는 UI가 정한 경로에 `shareCode`를 넣습니다(예: `/study/?exam=<shareCode>`). 받은 사람은 `GET /api/shared-exams/:shareCode`로 제목·문항 수를 보여 주고, 풀기 시작할 때 `POST /api/shared-exams/:shareCode/attempts`로 `attemptId`와 정답 없는 문항을 받습니다. 새로고침하면 같은 요청이 미완료 응시를 다시 돌려줍니다(`resumed: true`).
4. 모든 문항에 답하면 `POST /api/attempts/:attemptId/answers` → 점수·정답·AI 해설(`details`)·집계 여부(`counted`).
5. 결과 화면은 `GET /api/shared-exams/:shareCode/results`(토큰 포함) → `state`가 `empty`면 "아직 비교할 참여자가 없어요", `insufficient`면 "비교할 다른 참여자가 아직 없어요(1명)", `ready`면 참가 수·평균·내 공동 순위·문항별 정답률을 표시합니다. `me.counted`가 `false`이고 `reason`이 `author`면 "정답을 아는 작성자는 순위에서 빼요", `practice`면 "다시 푼 기록은 연습으로만 남아요"를 표시합니다. 예상 학점·시험 점수·백분위는 만들지 않습니다.
6. 풀이 참고는 제출 뒤 `GET /api/shared-exams/:shareCode/solutions`로 AI 공통 해설(`ai`)과 학생 풀이(`students`)를 **구분해** 보여 줍니다. 본인 풀이는 `PUT`/`DELETE /api/attempts/:attemptId/solution`.
7. 내 시험지 목록은 `GET /api/question-sets`(토큰) → `authored`(만든 시험)·`attempted`(푼 시험)로 그립니다. 재접속·새로고침은 `GET /api/attempts/:attemptId`로 응시 상태를 다시 읽습니다. `setId`·`shareCode`·`attemptId`는 localStorage 또는 URL에 두고 데이터는 서버에서 다시 읽습니다.

### POST /api/participants
참가자 토큰 발급. 본문 없음.

응답 `201`:
```json
{ "ok": true, "participantId": "9f2c…(32자)", "participantToken": "…(43자 base64url)" }
```

### POST /api/question-sets  (토큰 선택, 권장)
생성 문항 저장 = 공유 시험 만들기. 토큰이 있으면 작성자로 기록되어 그 시험의 집계에서 빠집니다. `examId`를 주면 같은 시험의 **새 버전**(작성자만, 아니면 `403 not_author`).

요청 본문:
```json
{ "title": "자료구조 3장", "source": "school-ai", "examId": "선택: 기존 examId", "questions": [ { "body": "…", "choices": ["…","…","…","…"], "answerIndex": 1, "explanation": "…", "evidence": { "page": 3, "quote": "…" } } ] }
```
- `questions[]`는 `/api/generate` 응답의 `questions`를 그대로 보내면 됩니다(`answer_index`도 수용).

응답 `201`:
```json
{ "ok": true, "setId": "uuid", "examId": "set:uuid", "examVersion": 1, "shareCode": "k7m2p9qa", "title": "자료구조 3장", "courseId": "demo-data-structures", "source": "school-ai", "questionCount": 5, "maxScore": 50, "createdAt": "…", "isAuthor": true, "reused": false }
```
- `reused: true`면 같은 참가자가 같은 세트를 이미 저장한 것(연타·재전송)이며 새 행을 만들지 않았습니다.

### GET /api/question-sets  (토큰 필수)
내 시험지 목록. 정답은 없습니다.

응답 `200`:
```json
{ "ok": true, "storage": "supabase",
  "authored": [ { "setId": "…", "examId": "…", "examVersion": 1, "shareCode": "…", "title": "…", "questionCount": 5, "maxScore": 50, "createdAt": "…" } ],
  "attempted": [ { "setId": "…", "shareCode": "…", "title": "…", "examVersion": 1, "questionCount": 5, "maxScore": 50, "attemptId": "…", "status": "graded", "score": 30, "correctCount": 3, "counted": true, "countedReason": "first_completion", "gradedAt": "…", "isAuthor": false } ] }
```
- `attempted`는 세트당 가장 최근 응시 하나. `status`는 `open`(풀던 중) 또는 `graded`.

### GET /api/shared-exams/:shareCode
공유 시험 공개 정보. 정답·해설·근거는 없습니다.

응답 `200`: `{ "ok": true, "setId", "examId", "examVersion", "shareCode", "title", "questionCount", "maxScore", "createdAt", "storage", "questions": [ { "id": "q1", "body": "…", "choices": ["…"], "qtype": "choice", "concept": null, "difficulty": null } ] }` · 없는 코드 `404 exam_not_found`.

### POST /api/shared-exams/:shareCode/attempts · POST /api/question-sets/:setId/attempts  (토큰 필수)
응시 시작. 요청 본문 `{ "nickname": "선택, 20자 이내" }`.

응답 `201`:
```json
{ "ok": true, "attemptId": "uuid", "resumed": false, "willCount": true, "willCountReason": "first_completion", "setId": "…", "examId": "…", "examVersion": 1, "shareCode": "…", "title": "…", "questionCount": 5, "maxScore": 50, "storage": "supabase", "questions": [ { "id": "q1", "body": "…", "choices": ["…","…","…","…"], "qtype": "choice" } ] }
```
- 같은 참가자의 미완료 응시가 있으면 새로 만들지 않고 그 응시를 `resumed: true`로 돌려줍니다.
- `willCountReason`: `first_completion`(집계됨) · `practice`(이미 집계된 완료가 있어 연습) · `author`(작성자, 집계 제외).

### POST /api/attempts/:attemptId/answers  (공유 시험 응시는 토큰 필수)
서버 채점. 요청 본문 `{ "answers": { "q1": 1, "q2": 0, … } }` — 모든 문항 필요(`400 answers_incomplete`). 남의 응시는 `403 not_owner`.

응답 `200`:
```json
{ "ok": true, "attemptId": "…", "setId": "…", "examId": "…", "examVersion": 1, "shareCode": "…", "score": 30, "maxScore": 50, "correctCount": 3, "questionCount": 5, "passed": false, "stars": 1, "counted": true, "countedReason": "first_completion", "alreadyGraded": false, "gradedAt": "…", "explanationSource": "ai",
  "details": [ { "questionId": "q1", "answer": 1, "correct": true, "answerIndex": 1, "explanation": "…", "evidence": { "page": 3, "quote": "…" } } ] }
```
- 재전송(응답 유실 뒤 재시도 포함)은 같은 결과에 `alreadyGraded: true`. 점수·인원이 늘지 않습니다.
- 스테이지(샘플) 응시는 기존대로 토큰 없이 동작하며 `xpAwarded`를 포함합니다.

### GET /api/attempts/:attemptId  (토큰 필수)
재접속용 본인 응시 상태. 채점 전은 `status: "open"`과 정답 없는 `questions`, 채점 후는 `status: "graded"`와 위 채점 응답 전체.

### GET /api/shared-exams/:shareCode/results  (토큰 선택)
같은 시험·버전의 집계 응시만으로 계산한 비교 결과.

응답 `200`:
```json
{ "ok": true, "setId": "…", "examId": "…", "examVersion": 1, "shareCode": "…", "title": "…", "questionCount": 5, "maxScore": 50,
  "basis": "anonymous_participants", "state": "ready", "participantCount": 3, "averageScore": 36.7,
  "questionStats": [ { "questionId": "q1", "answeredCount": 3, "correctCount": 2, "correctPercent": 67 } ],
  "me": { "attemptId": "…", "score": 30, "correctCount": 3, "rank": 2, "tiedCount": 2, "counted": true },
  "storage": "supabase" }
```
- `state`: `empty`(0명) · `insufficient`(1명) · `ready`(2명 이상). `averageScore`·`correctPercent`는 0명이면 `null`.
- `rank` = 나보다 높은 점수의 참가자 수 + 1(동점은 공동 순위, `tiedCount`에 같은 점수 인원).
- 토큰이 없으면 `me: null`. 집계되지 않은 참가자는 `me: { "counted": false, "reason": "author" | "not_submitted", "score": 50 | null, "correctCount": … }`.
- 다른 참가자의 답안·닉네임 목록은 주지 않습니다. 정답(`answerIndex`)도 없습니다.

### GET /api/shared-exams/:shareCode/solutions  (토큰 필수, 제출자만)
제출 전이면 `403 not_submitted`.

응답 `200`:
```json
{ "ok": true, "setId": "…", "shareCode": "…", "title": "…", "examVersion": 1,
  "ai": { "source": "ai", "label": "AI 공통 해설", "items": [ { "questionId": "q1", "answerIndex": 1, "explanation": "…" } ] },
  "students": { "source": "student", "label": "학생 풀이", "format": "plain_text", "maxLength": 300,
    "items": [ { "nickname": "비", "text": "…", "sharedAt": "…", "mine": false }, { "nickname": "익명", "text": "…", "sharedAt": "…", "mine": true, "attemptId": "…" } ] },
  "storage": "supabase" }
```
- `students.items`는 참가자별 최근 공유 풀이 1개. 본인 것만 `mine: true`와 `attemptId`를 줍니다.

### PUT /api/attempts/:attemptId/solution  (토큰 필수, 본인·채점 완료 응시)
요청 본문 `{ "text": "300자 이내 일반 텍스트" }`. 비면 `400 solution_empty`, 넘치면 `400 solution_too_long`, 제출 전이면 `403 not_submitted`.

응답 `200`: `{ "ok": true, "attemptId": "…", "solution": { "text": "…", "sharedAt": "…", "format": "plain_text" } }`

### DELETE /api/attempts/:attemptId/solution  (토큰 필수)
공유 취소. 응답 `200`: `{ "ok": true, "attemptId": "…", "solution": null }`

### 검증 상태 (2026-10-03, 브랜치 `feat/common-exam-db`)

- `node --test tests/exam-workspace/shared-exam.test.mjs`(로컬 JSON 모드): 참가자 6명 발급, 작성자 저장·공유 조회(정답 비노출), 두 참가자 다른 답(50점·30점)의 서버 채점과 집계(2명·평균 40·1위/2위·문항별 정답률), 재전송·연습 재응시 비집계, 동점 공동 2위, 작성자 제외, 0명 `empty`·1명 `insufficient`, 다른 버전·다른 시험 분리, 대리 제출·무토큰·미응답·임의 점수 차단, 풀이 300자·수정·취소·제출자만 조회, 연타 중복 저장 방지, 내 시험지 목록, 서버 재시작 뒤 보존, 기존 스테이지 채점 회귀 — 통과.
- Supabase 모드: 테이블이 없는 프로젝트에 연결하면 `502 db_error`로 실패를 그대로 돌려줍니다(성공으로 꾸미지 않음). **팀 DB에 `supabase/shared-exams.sql`을 적용한 뒤** `SHARED_EXAM_TEST_STORAGE=supabase`로 같은 검사를 실행해야 실제 DB 저장·재조회가 확인됩니다. 아직 미실행.
- 화면 연결·배포 확인은 UI 담당자와 배포 담당자가 별도로 합니다. 이 문서는 그 전까지 연결됐다고 주장하지 않습니다.

### 생성 API 변경 안내 (FR-12B 출제 품질, UI 담당자 참고)

- `/api/generate` 응답에 `rulesVersion`(현재 `2`)과 각 문항의 `kind`가 추가됐습니다. 수업 운영 안내 문항은 서버가 거르며, 운영 안내 때문에 5문항이 안 되면 `422 not_enough_study_content`(본문 `validCount`·`logisticsCount`·`rejectedReasons`)로 "학습 내용이 있는 쪽을 다시 고르라"는 메시지를 줍니다. 화면은 이 코드를 받으면 파일·범위를 유지하고 범위 재선택을 안내하면 됩니다.
- **옛 캐시**: `make.mjs`는 같은 자료·범위의 생성 결과를 `pf.make.sets`에 저장해 재사용하므로, 예전 규칙으로 만든 공지 문항이 그대로 보일 수 있습니다. 서버는 바꾸지 못하는 부분이라 UI 담당자에게 넘깁니다. 수정 범위: 저장할 때 `rulesVersion: data.rulesVersion`을 함께 저장하고, 재사용 조건에서 `set.rulesVersion !== 2`(또는 없음)이면 "예전 규칙으로 만든 문제예요 · 다시 만들기" 안내 뒤 새로 생성하도록 합니다(강제 삭제 대신 사용자가 선택).
