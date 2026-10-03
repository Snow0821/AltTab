# AltTab (PassFinder) 통합 검증본

이 브랜치는 PR #4의 Next.js 구현을 팀 코드와 함께 보존하는 **별도 통합 검증 브랜치 `docs/project-handoff`**다. 학교 AI 호출이 동작한다고 보고된 Express `main`의 제출 실행을 자동으로 대체하지 않는다. 운영자가 API 비용을 부담하고 학생은 웹 학습서비스 이용료를 내는 방향이며, 개인 AI 계정·MCP 연결 없이 이용하는 전체 흐름은 아직 정합화 중이다.

## 현재 상태

| 대상 | 상태와 근거 |
| --- | --- |
| Express 제출 기준 | 원격 `main@3e2649b`. 팀원 보고로 학교 AI 5문항 생성 약 17초, 배포 검사 12/12 통과. 통합 담당은 해당 코드 경로를 확인했으며 같은 배포 실행을 여기서 재현한 것은 아님 |
| Next.js 통합 대상 | `feat/nextjs-foundation@7c60c42`. 가입·과목·PDF·MCP·스테이지·모의 결제와 서버 첫 유닛 생성 코드 포함 |
| 통합 검증 | 통합 담당 실행 기준 Next 단위 검사 17개, 기존 Express 검사 10개, Next 빌드 통과 |
| 남은 검증 | 새 DB 생성·적용, Next 실제 DB·AI 연동 전체 흐름, 공개 배포. 빌드 성공은 서비스 전체 동작이나 사업성 증거가 아님 |
| 운영 결정 | 15시 제출 안전판은 Express main으로 유지. Next 통합본은 검증 후 별도로 전환 여부를 판단 |

사용자가 새 DB를 만드는 중이다. DB가 준비됐다고 가정하거나 기존 배포 환경을 바꾸지 않는다. 현재 Next 서버 생성은 첫 5개 개념·25문항 범위이며 추가 문항·공유 검수에는 기존 MCP 경로가 남아 있다.

## 읽는 순서

1. [인수인계](인수인계.md): 브랜치별 상태, 근거 출처, 이어갈 일
2. [PRD](PRD.md): 이 Next 통합본의 구현 범위·기능별 완료 기준
3. [설계서](docs/설계.md): 데이터·API·검수·운영 설계
4. [운영 방향·축소안](docs/proposals/PRD-revision.md): 서버 AI 운영 목표와 축소 제안. 현재 코드의 제공량·가격을 대체하지 않음
5. [협업 가이드](CONTRIBUTING.md), [AI 작업 지침](AGENTS.md)

원격 main의 제출 PRD는 해당 브랜치의 `CramMate(벼락치기 구조대) PRD (1).md`를 유지한다. 이 브랜치의 PRD와 제출 문서를 혼용하지 않는다. 과목 1회 2,900원·모든 과목 30일 9,900원이 현재 Next 상품이며 월 2,900원 제안과의 차이는 후속 정합화 사항이다.

## 실행 방법

이 브랜치의 실행은 Next.js다. Express main의 실행 방법은 해당 main README를 따른다.

```bash
npm install
npm test
npm run build
npm run dev
```

실제 학습 흐름에는 [.env.example](.env.example)의 Supabase 설정과 [스키마](supabase/schema.sql)가 필요하다. 새 DB를 확인한 뒤 SQL Editor 또는 `npm run db:apply`로 적용한다. `npm run db:check`는 읽기 전용이 아니며 테스트 계정·데이터·실패 주입용 함수를 만든다. 중간 실패 시 정리가 남을 수 있으므로 별도 검증 환경에서만 실행한다. API 키는 서버 환경변수에만 둔다. 실제 Next AI 생성·저장 전체 흐름은 아직 검증하지 않았다.

## 파일 구조

- `app/`, `components/`: Next 화면·API와 공통 화면 요소
- `lib/`: 인증·DB·채점·AI 생성·MCP
- `supabase/schema.sql`: Next 데이터 구조·권한
- `scripts/`, `tests/`: 적용·점검 도구와 검사
- `docs/`: 설계·운영 제안·팀 분담
- `mvp-express/`: 통합 시 보존한 Express 코드. 최신 원격 main 배포본과 같은 버전이라고 가정하지 않음
- `public/exam-workspace/`: 보존한 정적 학습 화면

## 협업 안내

최신 협업 절차는 [CONTRIBUTING.md](CONTRIBUTING.md)를 따른다. 이번 통합본은 별도 브랜치로 공유하며, 제출 안전판 Express main의 실행 구조·배포를 변경하는 승인을 대신하지 않는다. 다른 팀원의 진행 중인 파일과 DB 설정을 보존한다.
