# passfinder

팀: AltTab

문제·필수 기능·구현 상태는 [passfinder PRD](passfinder-prd.md) 한 개를 기준으로 합니다. 같은 시험 공유·결과 비교·풀이 참고가 핵심입니다. 세트 저장·출제·채점 API는 일부 구현됐고 DB·비교·화면 연결은 남아 있습니다.

- 개발 담당: [클로드에게 전달할 서버·DB 구현 지시](docs/클로드_공통시험_구현지시.md). UI는 별도 담당자가 수정합니다.
- 발표 담당: [제작 흐름](docs/presentation/발표제작흐름.md), [제작 원칙](docs/presentation/발표자료_제작원칙_공유용.md).

**현재 제출용 AI 학습 화면:** [교안으로 문제 만들기](https://alt-tab-mu.vercel.app/study/make.html). 서버가 학교 AI를 호출하며 학생의 개인 AI 설정은 필요 없습니다. 결과는 해당 브라우저에 저장됩니다.

운영 구조·검증 결과·PR #4의 별도 보존·남은 DB 연결은 [인수인계](인수인계.md)를 확인해 주세요. 제출용 `main`은 Express를 유지합니다.

교안 PDF로 연습문제 5개를 만들고, 답·해설 확인과 오답 복습을 돕는 서비스입니다.

## 실행 방법

```bash
npm install
npm start
```

브라우저에서 `http://localhost:3000/`로 접속하면 `index.html`의 통합 화면이 열립니다. AI 문제 만들기는 `/study/make.html`, 기존 PDF 업로드 화면은 `/upload`에서 이용할 수 있습니다. 실제 AI 생성에는 서버의 `KOOKMIN_KEY` 설정이 필요합니다.

## 배포

Node.js(`>=18`)를 지원하는 플랫폼(Render, Railway 등)에 `npm install && npm start`로 배포 가능합니다. 환경변수 `PORT`를 플랫폼이 지정하면 자동으로 사용합니다.

## 협업 안내

**최신 작업 방식 (2026-10-03): 각 팀원과 AI가 최신 `main`을 동기화한 뒤 직접 일반 push합니다. PR 제출과 Mint의 사전 검토·승인은 필수가 아닙니다.**

작업 전 [협업 가이드](CONTRIBUTING.md)를 확인하고, 다른 사람의 작업을 보존하세요. AI 도구는 [AGENTS.md](AGENTS.md)도 따릅니다. 이 안내가 과거의 필수 PR·검토 절차보다 우선합니다.
