# AltTab (PassFinder)

PassFinder는 교안 PDF를 올리면 내 AI가 만든 문항을 같은 수업 학생들의 AI가 교차 검수하고, 학생은 쉬운 개념부터 한 스테이지(5문제)씩 풀며 시험 범위를 끝까지 확인하는 시험 대비 웹 서비스다. 요구사항은 [PRD.md](PRD.md)가 정본이다.

## 현재 상태

- 된 것: Next.js 뼈대, 데이터베이스 스키마(`supabase/schema.sql`), 가입·로그인·과목 만들기·참여 코드 API와 첫 화면, 공통 라이브러리, 스테이지 규칙 단위 테스트.
- 안 된 것: 교안 업로드·색인, MCP 서버, 스테이지 맵·플레이, 결제, 공개 배포. 데이터베이스(Supabase)는 아직 만들지 않아 실제 동작을 확인하지 못했다.
- 처음 만든 Express MVP(교안 PDF 업로드 확인)는 [mvp-express/](mvp-express/)에 그대로 보존했다.

## 읽는 순서

1. [PRD.md](PRD.md): 문제, 필수 기능(FR-01~06)과 완료 기준, 초안 대비 변경(부록 2)
2. [docs/설계.md](docs/설계.md): 수익모델 검토, 위험, DDBM 캔버스, 유스케이스, 시퀀스, 데이터, 아키텍처, API·MCP 계약
3. [docs/작업표.md](docs/작업표.md): 5명 담당, 수정 파일, 기한
4. [CONTRIBUTING.md](CONTRIBUTING.md), [AGENTS.md](AGENTS.md): 브랜치·PR 규칙

## 실행 방법

확인한 명령만 적는다.

```bash
npm install        # 의존성 설치
npm test           # 스테이지 규칙 단위 테스트(8개)
npx next build     # 빌드
```

데이터베이스가 준비되면 `vercel env pull .env.local` → `npm run db:apply`(스키마 적용) → `npm run dev` 순서로 실행한다. 이 세 단계는 아직 실행해 보지 않았다.

## 파일 구조

- `app/`: 화면과 API(Route Handler). `app/api/mcp/`는 MCP 서버 자리
- `components/`: 화면 조각(스테이지 맵, 교안 패널 등)
- `lib/`: 인증, DB 접근, 오류 형식, 스테이지 규칙(`rules.ts`)
- `supabase/schema.sql`: 표·뷰·권한 정본
- `scripts/db-apply.mjs`: 스키마 적용
- `tests/`: 단위 테스트
- `docs/`: 설계서, 작업표
- `mvp-express/`: 처음 만든 Express MVP 보존본

## 협업 안내

작업 전 [협업 가이드](CONTRIBUTING.md)를 확인해 주세요. 작업별 브랜치에서 변경하고 PR로 제출하며, Mint가 검토를 통과한 PR을 병합합니다.

AI 도구는 [AGENTS.md](AGENTS.md)도 따라야 합니다. Snow0821 계정을 사용하는 경우에도 Mint 외 모든 AI는 별도 PR을 제출합니다.
