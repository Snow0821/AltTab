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

작업 전 [협업 가이드](CONTRIBUTING.md)를 확인해 주세요. 작업별 브랜치에서 변경하고 PR로 제출하며, Mint가 검토를 통과한 PR을 병합합니다.

AI 도구는 [AGENTS.md](AGENTS.md)도 따라야 합니다. Snow0821 계정을 사용하는 경우에도 Mint 외 모든 AI는 별도 PR을 제출합니다.
