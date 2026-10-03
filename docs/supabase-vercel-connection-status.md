# AltTab Supabase와 Vercel 연결 점검

문서 갱신 시각: 2026년 10월 3일 15:03 KST

## 최신 결과: 2026-10-03 15:01 KST 실제 웹 검증

**[연결 테스트 화면](https://alt-tab-mu.vercel.app/mock/)에서 Vercel 서버 → Supabase 저장·별도 읽기·값 정확 일치를 확인했습니다.**

- 구현 커밋: [ec458ca](https://github.com/Snow0821/AltTab/commit/ec458ca814e4b1a09709a2acbe39fd4d2d99e422). GitHub의 Vercel 상태 success 및 실제 배포 화면 확인
- 실제 입력: `AltTab Vercel DB 테스트 2026-10-03`. 화면에 저장 ✓ / 읽기 ✓ / 정확히 일치 ✓ 표시, DB 직접 조회에서도 동일 값 확인
- 현재 Express 연결 테스트가 쓰는 서버 변수는 `SUPABASE_KEY`, `KOOKMIN_KEY`. 배포 런타임이 두 변수의 존재를 확인했으며 실제 값은 조회·복사·출력하지 않음
- 승인받은 격리 테이블 `public.alttab_connection_test` 1개 생성. 한 행만 유지, RLS 활성화·공개 정책 0개·익명 조회 0행 확인. 기존 앱 테이블/데이터는 변경하지 않음
- **LLM 실호출은 아직 미실행.** 학교 요금표가 로그인 뒤에 있어 실제 단가·최소 요금·배율과 승인된 $0.01 상한을 검증하지 못함. 15:01 KST에 전역 1회 호출권이 미사용인 것을 확인
- 공개 시연: DB 입력 200자, LLM 전체 방문자 합계 1회·출력 32토큰, 2026-10-03 20:00 KST 이후 쓰기/AI 호출 중지. 추가 호출권은 자동으로 복구하지 않음
- 코드/HTTP/DOM 테스트 29개 통과. 클라우드 브라우저에서 실제 DB 버튼 흐름과 화면을 확인

상세 범위·제한은 [연결 시연 안내](connection-check.md)를 참조하세요. 이 성공은 연결 테스트 테이블에 한정되며 점수·문제 세트 등 앱 전체가 Supabase 저장으로 전환됐다는 뜻은 아닙니다. Preview/Development별 환경 설정과 Vercel Marketplace 통합 설정은 별도 미확인입니다.

## 14:00 이전 점검 원문

아래 내용은 당시 상태를 보존한 기록입니다. 빈 스키마, 미실행 런타임, PR #4 변수 설명은 최신 상태가 아니며 위 결과가 우선합니다.



DB 테스트 시각: 2026년 10월 3일 13:46 KST

## 당시 결론 (14:00 KST)

**AltTab Supabase DB의 읽기 전용 연결 테스트가 통과했습니다.** `SELECT 1 AS connection_ok;`에 `connection_ok = 1`이 반환됐습니다. 다만 public 스키마의 테이블과 마이그레이션 이력은 모두 비어 있습니다. Vercel의 실제 환경 변수와 배포 런타임은 아직 확인하지 못했으므로, Vercel에서 앱이 DB를 정상 사용한다는 검증까지 완료된 것은 아닙니다.

이 문서는 팀원이 현재 상태, 필요한 설정, 다음 검증 절차를 함께 확인하기 위한 기록입니다. 비밀번호, API 키 값, 인증 토큰, DB 접속 문자열, 사용자 데이터는 포함하지 않습니다.

## 확인한 상태

| 항목 | 상태 | 확인 내용 |
| --- | --- | --- |
| Vercel 팀 | 확인 | Vercel 팀 조회를 완료했습니다 |
| Vercel 대상 프로젝트 | 일부 확인 | PR #9의 Vercel 봇 댓글에서 alt-tab 프로젝트와 자동 Preview Ready 상태를 확인했습니다. 실제 설정과 런타임 연결은 미확인입니다 |
| 새 Supabase 프로젝트 | 확인 | 사용자가 제공한 프로젝트를 직접 조회해 이름 AltTab과 ACTIVE_HEALTHY 상태를 확인했습니다 |
| DB 리전과 버전 | 확인 | Tokyo ap-northeast-1, PostgreSQL 17.11 |
| public 스키마 테이블 | 확인 | 테이블 목록이 비어 있습니다 |
| 마이그레이션 이력 | 확인 | 등록된 마이그레이션 목록이 비어 있습니다 |
| Supabase와 Vercel 통합 연결 | 미완료 | DB 대상은 확인했습니다. Vercel 대상 설정과 실제 통합 연결은 확인이 필요합니다 |
| Vercel 환경 변수 이름과 적용 환경 | 미확인 | 프로젝트 환경 변수 화면에서 팀 계정의 본인 확인이 요구됐습니다 |
| KOOKMIN_KEY 저장 | 사용자 보고 | 저장했다는 보고를 받았습니다. 실제 변수 존재 여부, 적용 환경, 배포 반영 여부는 확인하지 못했습니다 |
| 직접 DB 읽기 연결 테스트 | 통과 | 2026-10-03 13:46 KST에 SELECT 1 결과 connection_ok = 1을 확인했습니다 |
| Vercel 런타임에서 DB 연결 테스트 | 미실행 | 배포본, 환경 변수 적용, 사용할 읽기 전용 경로가 확인되지 않았습니다 |

## 코드가 기대하는 환경 변수

아래는 검토 중인 [PR #4](https://github.com/Snow0821/AltTab/pull/4)의 커밋 `668c80f131602b50cfdb459480f31c0c81d7142a`에서 확인한 변수 이름입니다. 현재 main은 Express MVP이며, PR #4의 Next.js 구현은 Draft 상태입니다. 실제 Vercel 배포 커밋과 아키텍처를 먼저 확인해야 합니다.

| 용도 | 코드에서 읽는 변수 | 확인한 동작 |
| --- | --- | --- |
| 브라우저 Supabase URL | NEXT_PUBLIC_SUPABASE_URL | 브라우저 클라이언트에서 필요합니다 |
| 브라우저 Supabase 키 | NEXT_PUBLIC_SUPABASE_ANON_KEY 또는 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY | 코드상 ANON_KEY가 우선입니다 |
| 서버 Supabase URL | NEXT_PUBLIC_SUPABASE_URL 또는 SUPABASE_URL | 코드상 NEXT_PUBLIC_SUPABASE_URL이 우선입니다 |
| 서버 Supabase 관리자 키 | SUPABASE_SERVICE_ROLE_KEY 또는 SUPABASE_SECRET_KEY | 코드상 SERVICE_ROLE_KEY가 우선입니다. 서버 전용이며 공개 접두사를 붙이면 안 됩니다 |
| DB 점검 스크립트의 Postgres 연결 | POSTGRES_URL_NON_POOLING 또는 POSTGRES_URL | db:check에서 읽습니다. 이 스크립트는 이번 연결 점검에 실행하지 않았습니다 |
| 현재 임베딩 구현 | OPENAI_API_KEY 또는 AI_GATEWAY_API_KEY 또는 VERCEL_OIDC_TOKEN | OPENAI_API_KEY를 먼저 확인하고, 없으면 Vercel AI Gateway 경로를 사용합니다 |
| 사용자가 저장한 국민대 키 | KOOKMIN_KEY | 검토본에서 이 변수 이름을 읽는 코드는 찾지 못했습니다 |

KOOKMIN_KEY를 저장하는 것만으로 현재 임베딩 코드가 해당 키를 사용하는 것은 아닙니다. 제공자의 공식 API 주소, 인증 방식, 사용 가능한 모델을 확인하고 코드의 연결 방식을 맞춰야 합니다. 다른 제공자용 변수에 키 이름만 바꿔 넣는 방식은 사용하지 않습니다.

## 연결 방식과 보안 범위

이미 만든 Supabase 프로젝트를 연결해야 하므로 새 DB를 만드는 경로와 구분해야 합니다. Vercel의 Supabase 통합은 기존 외부 프로젝트의 환경 변수 동기화를 지원합니다. Vercel 팀의 본인 확인을 완료하고 alt-tab 설정에서 기존 Supabase 프로젝트 AltTab을 선택한 뒤, 필요한 적용 환경과 최종 권한을 확인합니다. 현재 화면의 정확한 후속 버튼 이름은 미확인입니다.

통합이 동기화할 수 있는 항목에는 공개 URL뿐 아니라 서버용 키와 DB 비밀번호도 포함됩니다. 인증과 최종 권한 부여, 비밀 값 입력은 안전한 서비스 화면에서 진행합니다. 문서, PR 본문, 댓글, 채팅에 실제 값을 복사하지 않습니다.

Production, Preview, Development별 설정 여부를 각각 기록해야 합니다. Preview가 운영 DB에 쓰기 접근할 수 있게 연결되어도 되는지는 별도로 확인해야 합니다. 현재 어떤 환경에 설정됐는지는 미확인입니다.

## 남은 연결 검증

1. Vercel alt-tab의 실제 배포 커밋과 프레임워크를 확인합니다. 검토 중인 PR의 설정을 배포 완료 상태로 간주하지 않습니다.
2. 환경 변수의 **이름, 존재 여부, 적용 환경**만 확인합니다. 값을 출력하거나 문서에 저장하지 않습니다.
3. 사용할 애플리케이션 스키마를 확정합니다. 현재 public 테이블과 마이그레이션 이력이 모두 비어 있으므로 스키마가 필요한 기능은 아직 준비되지 않았습니다. 스키마 적용은 별도 변경이며 이번 읽기 전용 테스트에 포함하지 않습니다.
4. 실제 Vercel 런타임에서 동작하는 기존 읽기 전용 경로가 있으면 이를 통해 연결을 확인합니다. 직접 SQL 성공만으로 Vercel 연결까지 성공했다고 기록하지 않습니다. 새 엔드포인트나 새 배포가 필요하면 그 변경 범위를 먼저 확정합니다.
5. 실행 시각, 대상 환경, 테스트 종류, 성공 또는 실패, 비밀 정보를 제거한 오류 요약을 이 문서에 추가합니다.

## 이번 점검에서 실행하지 않은 작업

- db:check는 계정과 데이터를 만들고 삭제하며 실패 주입용 트리거와 함수를 변경하므로 실행하지 않았습니다
- DB 마이그레이션, RLS 변경, 권한 확대, 키 복사 또는 등록, 신규 DB 생성, 수동 배포를 수행하지 않았습니다
- 문서 브랜치 공개 후 기존 Vercel GitHub 연동이 자동으로 Preview를 생성했습니다. Ready 표시는 배포 상태이며 DB나 LLM 연결 성공의 증거는 아닙니다
- KOOKMIN_KEY를 사용하는 외부 API 호출은 미실행이며 후속 점검으로 남겨둡니다. 이번 문서는 Supabase 연결 결과를 먼저 공유합니다

## 점검 기록

| 확인 시각 | 확인 항목 | 결과 |
| --- | --- | --- |
| 2026-10-03 13:38~13:40 KST | Supabase 프로젝트 목록과 Vercel 팀 조회 | 팀은 확인했고, 새 Supabase 프로젝트와 AltTab 프로젝트 세부 정보는 확정하지 못했습니다 |
| 2026-10-03 13:43 KST | PR #4 검토본의 DB 클라이언트와 db:check 소스 확인 | 환경 변수 이름 및 쓰기 동작이 있는 점검 스크립트임을 확인했습니다 |
| 2026-10-03 13:43~13:44 KST | Vercel 환경 변수 화면 접근 | 팀 계정 본인 확인이 요구돼 이름과 적용 환경을 확인하지 못했습니다 |
| 2026-10-03 13:44 KST | KOOKMIN_KEY 코드 참조 검색 | 검토본에서 사용처를 찾지 못했습니다 |
| 2026-10-03 13:46 KST | 사용자가 제공한 Supabase 프로젝트 직접 조회 | AltTab, ACTIVE_HEALTHY, Tokyo, PostgreSQL 17.11을 확인했습니다 |
| 2026-10-03 13:46 KST | SELECT 1 AS connection_ok | connection_ok = 1, 읽기 전용 연결 테스트 통과 |
| 2026-10-03 13:46 KST | public 스키마 테이블 및 마이그레이션 목록 | 두 목록 모두 비어 있었습니다 |
| 2026-10-03 13:49 KST | GitHub main 및 PR #4 최신 커밋의 코드 재확인 | main은 Express MVP, PR #4는 Draft. Supabase 변수 이름과 임베딩 변수 불일치가 그대로 확인됐습니다 |
| 2026-10-03 13:55 KST | 문서 브랜치의 Vercel 자동 Preview | 공식 봇 댓글에서 Ready 확인. DB·LLM 런타임 테스트는 미실행 |

## 참고 자료

- [PR #9 Vercel Preview 상태](https://github.com/Snow0821/AltTab/pull/9#issuecomment-5965733439)
- [Supabase의 Vercel 연결 안내](https://supabase.com/partners/vercel)
- [Vercel Supabase 통합](https://vercel.com/marketplace/supabase/supabase)
- [Supabase Vercel Marketplace 문서](https://supabase.com/docs/guides/integrations/vercel-marketplace)

코드 근거:

- [main의 package.json](https://github.com/Snow0821/AltTab/blob/main/package.json)
- [PR #4 서버 DB 클라이언트](https://github.com/Snow0821/AltTab/blob/668c80f131602b50cfdb459480f31c0c81d7142a/lib/supabase-admin.ts)
- [PR #4 브라우저 DB 클라이언트](https://github.com/Snow0821/AltTab/blob/668c80f131602b50cfdb459480f31c0c81d7142a/lib/supabase-browser.ts)
- [PR #4 임베딩 연결 구현](https://github.com/Snow0821/AltTab/blob/668c80f131602b50cfdb459480f31c0c81d7142a/lib/embed.ts)

db:check의 쓰기 동작은 PR #4 로컬 검토본의 scripts/db-check.mjs와 package.json에서 확인했습니다.
