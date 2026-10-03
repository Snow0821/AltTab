# API 계약 — 점수·랭킹·학습·이용권

이 문서는 현재 `main`의 Express `server.js`에 실제로 구현된 API 중 **점수/랭킹, 시험 출제/채점, 이용권** 엔드포인트를 기록합니다. 코드 기준 작성이며, 다른 담당자가 추가한 엔드포인트(예: 문항 생성)는 각 담당자가 별도로 문서화합니다.

- 기준 커밋: `main` (2026-10-03)
- 관련 모듈: `scores.js`, `exam.js`, `entitlements.js`
- 공통 성공 형식: `{ "ok": true, ... }`
- 공통 오류 형식: `{ "ok": false, "error": "메시지", "code": "선택적_코드" }`
- 저장: 환경변수(`SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`)가 없으면 `uploads/*.json` 로컬 폴백으로 동작합니다. 로컬 폴백은 인스턴스 재시작 시 유지되지 않을 수 있습니다.

> 사용자 식별: 현재 `userId`는 요청 본문/쿼리 값을 그대로 사용합니다. 공통 인증 계층이 준비되면 그 값으로 대체해야 합니다. 임의 `userId`를 신뢰해 권한을 판정하지 않도록 통합 시 교체가 필요합니다.

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
