# AltTab (PassFinder MVP)

교안 PDF를 업로드하고 웹에서 업로드된 목록/파일을 바로 확인할 수 있는 최소 기능 구현(MVP)입니다.

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
