# AltTab (PassFinder MVP)

교안 PDF를 업로드하고 웹에서 업로드된 목록/파일을 바로 확인할 수 있는 최소 기능 구현(MVP)입니다.

현재 운영 구조·검증 결과·이어갈 작업은 [인수인계](인수인계.md), 요구사항은 [서비스 설계안](docs/proposals/PRD-revision.md)을 먼저 확인해 주세요. 운영자가 서버 AI 비용을 부담하고 학생은 학습 서비스 이용료를 내는 구조입니다. 개인 AI 구독이나 MCP 설정은 학생의 필수 이용 조건이 아닙니다.

[공개 CramMate 체험 사이트](https://crammate-alttab.snow0821.chatgpt.site/)의 샘플 풀이·해설·복습은 확인했습니다. 실제 PDF 분석·AI 생성·서버 저장은 사이트 안내상 연결 전이며, 이 저장소와의 배포 버전 관계는 확인이 필요합니다.

## 실행 방법

```bash
npm install
npm start
```

브라우저에서 `http://localhost:3000` 접속 후 PDF 파일을 업로드하면 목록에 즉시 표시되고, 파일명을 클릭하면 새 탭에서 내용을 확인할 수 있습니다.

## 배포

Node.js(`>=18`)를 지원하는 플랫폼(Render, Railway 등)에 `npm install && npm start`로 배포 가능합니다. 환경변수 `PORT`를 플랫폼이 지정하면 자동으로 사용합니다.

## 협업 안내

**최신 작업 방식 (2026-10-03): 각 팀원과 AI가 최신 `main`을 동기화한 뒤 직접 일반 push합니다. PR 제출과 Mint의 사전 검토·승인은 필수가 아닙니다.**

작업 전 [협업 가이드](CONTRIBUTING.md)를 확인하고, 다른 사람의 작업을 보존하세요. AI 도구는 [AGENTS.md](AGENTS.md)도 따릅니다. 이 안내가 과거의 필수 PR·검토 절차보다 우선합니다.
