# 로고스AI 개발·운영 인수인계

최종 정리일: 2026-08-19 (Asia/Seoul)

이 문서는 다음 담당자가 현재 기능을 훼손하지 않고 개발, 검증, 배포를 바로 이어가기 위한 기준 문서입니다. 기능 설명은 `README.md`, 최초 요구사항은 `설계.json`, 실제 동작의 최종 기준은 원격 `main`의 추적 소스와 세 회귀 테스트(`rendered-html`, `auth-member-security`, `admin-members-security`)입니다.

## 0. 가장 먼저 확인할 것

> **권위 원본은 Sites 소스 저장소의 `main`입니다.** 2026-08-19 운영 기능 기준 커밋은 `721a98cf8b97eb9e74a1316e843f6b84919b5cc4`이며, 이 문서를 갱신한 후속 커밋은 문서만 바꿉니다. 새 컴퓨터에서는 문서에 적힌 과거 SHA로 되돌리지 말고 원격 `main`의 최신 HEAD에서 시작하세요.

- 현재 Google Drive 작업 폴더의 `.git`은 `.git-failed-import-20260818`을 가리키는 비정상 복구용 gitfile입니다. 이 Git 메타데이터와 `origin/main` 로컬 캐시는 다른 컴퓨터로 가져가면 안 됩니다.
- 현재 컴퓨터의 `git branch -vv`에 표시되는 `origin/main`은 낡을 수 있습니다. 강제 reset·checkout·merge로 맞추지 말고, 단기 Sites 자격으로 원격 `main`을 직접 확인하거나 새로 clone하세요.
- 현재 컴퓨터에서는 `git reset --hard`, `git gc`, `git prune`, 손상 ref 수리, `.git-failed-*`·`.git-unborn-*` 삭제를 실행하지 않습니다. 소스 전달은 Git 메타데이터 수리가 아니라 fresh clone으로 해결합니다.
- `.env*`, `.vercel/`, `node_modules/`, `.next/`, `.vinext/`, `dist/`, API 키와 인증 토큰은 복사·커밋·메신저 전송 금지입니다.
- `AI_SETTINGS_ENCRYPTION_KEY`를 바꾸면 DB에 저장된 기존 AI 공급자 키를 복호화할 수 없고, 이 값에 폴백한 최대 24시간짜리 성경 본문 정규화 승인도 무효화될 수 있습니다. 회전 전 공급자 키 재입력·재암호화, 별도 `SCRIPTURE_NORMALIZATION_SECRET`, 환경 폴백을 준비하세요.

### 새 컴퓨터 권장 시작 순서

1. Git과 Node.js 22.13 이상을 설치하고, Google Drive 밖의 짧은 로컬 경로(예: `C:\src\logos-ai`)를 준비합니다.
2. Codex에 `.openai/hosting.json`의 기존 Sites 프로젝트 ID `appgprj_6a76c13012188191a30b9235f13dd1fe`로 **소스 저장소 단기 쓰기 자격을 발급하고 `main`을 fresh clone**해 달라고 요청합니다. 원격은 현재 Git 설정의 `https://git.chatgpt-team.site/7ec72fcc-7c16-4a43-a492-8096977c110b/appgprj_6a76c13012188191a30b9235f13dd1fe.git`이며, 토큰은 명령 1회용 헤더로만 사용하고 URL이나 Git 설정에 저장하지 않습니다.
3. clone 직후 `git status`, `git log -5 --oneline`, `git remote -v`를 확인합니다. 작업 트리는 clean이어야 하고 `721a98c`가 최신 HEAD의 조상이어야 합니다.
4. `npm ci`로 lockfile 그대로 설치합니다. Google Drive의 기존 `node_modules`나 빌드 산출물을 복사하지 않습니다.
5. Vercel 권한이 있는 계정으로 기존 프로젝트 `sermon-guide-studio-kr`를 link합니다. `.vercel/project.json`은 Git에서 제외되므로 새 컴퓨터마다 다시 연결해야 합니다.
6. `.env.example`을 계약으로 삼아 승인된 비밀 저장소 또는 Vercel development 환경에서 `.env.local`을 복원합니다. 운영 비밀값을 문서·채팅·Git에 붙이지 말고, 로컬 콜백을 쓸 때 `NEXT_PUBLIC_SITE_URL=http://localhost:3000`과 Supabase Redirect URL을 함께 확인합니다.
7. 아래 순서로 설치와 기본 실행을 확인합니다.

```powershell
node --version
npm --version
npm ci
npx --yes vercel@latest link --yes --project sermon-guide-studio-kr
npx --yes vercel@latest env pull .env.local --yes --environment=development
npm run dev
```

운영 DB가 연결된 `.env.local`로 `npm run build`를 실행하면 RLS 보강 스크립트가 실제 DB에 접근합니다. UI만 개발할 때는 운영 DB URL을 넣지 말고, DB 작업은 대상 프로젝트와 백업·마이그레이션 범위를 먼저 확인하세요.

## 1. 운영 현황

| 항목 | 값 |
| --- | --- |
| 대표 서비스 | <https://www.sermon-ai.shop> |
| 보조 주소 | <https://sermon-ai.shop> → `www`로 이동 |
| 주 배포 | Vercel, 프로젝트 `sermon-guide-studio-kr`, 서울 리전 `icn1` |
| Sites 배포 | <https://sermon-guide-studio-kr.nettman001.chatgpt.site> |
| 런타임 | Node.js 22.13 이상, Next.js 16.3, React 19.2 |
| 주 데이터베이스 | Supabase PostgreSQL (`POSTGRES_URL` 또는 `POSTGRES_URL_NON_POOLING`) |
| 인증 | Supabase Auth 이메일/비밀번호 + Google OAuth |
| 배포 기준 | 기능 커밋 `721a98c`, Sites 기능 버전 32, Vercel·Sites 동시 배포 완료(2026-08-19) |
| 최종 검증 | 테스트 79개 통과, ESLint·TypeScript·Next.js·vinext 프로덕션 빌드 통과 |

대표 운영 주소와 Sites 배포본은 2026-08-19에 같은 기능 소스로 배포했습니다. 기능 수정 후에는 원격 `main`, Vercel, Sites가 같은 커밋을 가리키는지 확인하세요. Sites 주소는 private 배포이므로 비인증 `401`은 정상입니다.

## 2. 사용자 핵심 흐름

```text
/sermon
  → /sermon/options       설교 조건과 다섯 초안 공통 AI 엔진 선택
  → /sermon/input         본문·참고 자료 입력 및 초안 생성
  → /sermon/alternatives  다섯 초안 비교·선택
  → /sermon/edit          선택 원고 수정
  → /sermon/complete      저장·내보내기
```

그 밖의 주요 영역은 다음과 같습니다.

- `/history`: 저장 설교 열람, 인쇄, Word 내보내기
- `/consult`, `/expert`: 설교 피드백 요청 및 전문가 응답
- `/study`: 저장 설교의 원문·배경·구조 스터디 생성
- `/ministry`: 소그룹 질문지, 주보 요약문, 숏폼 문구 생성
- `/tokens`: 토큰 잔액과 충전
- `/notifications`: 알림 수신 설정
- `/my`: 신학 설정과 개인 설정
- `/admin/ai`: 관리자 전용 AI 엔진 설정
- `/admin/members`: 관리자 전용 회원 목록, 상세, 역할·상태·토큰·인증 지원

비회원은 서버가 강제하는 1회·1개 초안 미리보기만 사용할 수 있습니다. 로그인 사용자는 다섯 초안을 순차 생성하며 완성된 초안은 매 단계 저장됩니다.

## 3. 최근 완료한 중요 변경

### 로고스AI 개편과 설교 준비 확장

- 사용자 노출 서비스명을 `로고스AI`로 통일하고 메타데이터와 OG 이미지를 갱신했습니다. 저장 키·쿠키·배포 프로젝트명은 기존 사용자 호환을 위해 유지합니다.
- `/my`에 교단, 교단별 신학, 이름, 사역 역할, 교회, 이메일, 연락처를 구분해 제공합니다. 이메일은 인증 계정 원본을 읽기 전용으로 표시합니다.
- 설교 옵션을 제목, 10·15·20·25·30분, 유형, 1포인트·2~4대지, 대상, 청중 상황, 감정선으로 개편했습니다.
- 교단·신학·사역 역할·교회는 서버가 인증 프로필에서 직접 읽어 설교 생성·수정의 참고 문맥으로 주입합니다. 이메일과 연락처는 AI에 보내지 않습니다.
- `전문가 상담` 사용자 문구를 `설교 피드백`으로 바꾸되 기존 URL과 DB 계약은 유지합니다.
- `/study`와 `/ministry`를 추가했습니다. 두 기능은 저장한 완성 설교를 사용하며 설교 토큰 차감 없이 계정당 하루 20회·동시 1건의 공정 이용 한도를 적용합니다.

### 단일 AI 엔진 선택과 안정적인 생성

- 설교 옵션에서 `기본`, `고급`, `고급 추론` 중 하나만 선택하며 다섯 초안에 동일하게 적용합니다.
- `SermonOptions.aiTier`가 실제 선택값이고, `aiTiers`는 기존 API·저장 데이터 호환을 위해 같은 값을 다섯 번 복제합니다.
- 이전 브라우저의 혼합 `aiTiers`는 대표 `aiTier` 또는 첫 번째 과거 값을 기준으로 단일 엔진으로 자동 변환합니다.
- 호스팅 AI는 초안 한 편을 한 요청으로 만들고, `custom` OpenAI 호환 엔진만 서버 협상 후 짧은 조각으로 나누어 생성·재개합니다.
- 생성 중지 버튼은 현재 브라우저 요청과 서버의 공급자 요청에 취소 신호를 전달하며, 이미 완성한 초안은 보존합니다.
- 구조화 출력은 BOM·JSON 코드블록·일반 JSON 응답을 처리하고, custom/DeepSeek가 native 형식을 명시적으로 거부할 때만 스키마 프롬프트 방식으로 한 번 재시도합니다.
- DeepSeek Flash는 일반 생성 모드, Pro는 추론 모드로 호출합니다.

비용 공식의 단일 기준은 `app/_lib/sermon-token-pricing.ts`입니다. 생성 1회에 한 번만 차감하며 초안 개수는 비용에 포함하지 않습니다.

```text
비용 = 엔진 배수 × (설교 분량(분) + 5 + 2 × (대지 수 - 1))
엔진 배수: 기본 1 / 고급 2 / 고급 추론 4
```

10분·1포인트는 15/30/60토큰, 30분·4대지는 41/82/164토큰입니다. 같은 생성 ID의 초안 1~5와 조각 생성·재개는 중복 차감하지 않습니다.

### AI 관리자 설정

- 기본·고급·고급 추론의 세 엔진 설정을 `/admin/ai`에서 각각 저장합니다.
- 최초 화면은 관리자 인증이 끝난 서버 요청에서 설정을 함께 읽어 전달합니다. 재시도·저장·모델 조회는 15초 안에 끝나지 않으면 오류와 재시도 동작을 표시하므로 로딩 화면에 무기한 머물지 않습니다.
- 관리자 조회·저장은 DB 오류를 환경 기본값으로 숨기지 않고 503으로 종료합니다. 따라서 일시적인 읽기 장애가 저장된 암호화 키나 설정을 덮어쓰지 않습니다.
- OpenAI 호환 엔진은 API 키가 없어도 공개 모델 목록 API를 호출할 수 있습니다.
- API 키를 입력한 모델 조회도 지원하며 다양한 모델 응답 형태를 정규화합니다.
- 저장과 모델 조회 결과가 버튼 근처에 표시됩니다.
- API 키를 관리자 화면에서 저장할 때는 `AI_SETTINGS_ENCRYPTION_KEY`로 암호화해 DB에 저장합니다.
- 저장 키가 없거나 복호화할 수 없으면 서버 환경 변수의 공급자 키를 폴백으로 사용합니다.
- 각 엔진의 `최대 출력 토큰`은 선택값입니다. 공란(`NULL`)이면 설교 분량·작업 단계별 자동값을 사용하고, 숫자를 저장하면 해당 엔진의 설교 생성·조각·수정 요청에 적용합니다. 성경 본문 판정은 비용과 지연을 제한하기 위해 기존 500토큰 한도를 유지합니다.

### 토큰과 알림

- 앱 헤더에서 `총 토큰`과 `남은 토큰`을 표시합니다.
- 총 토큰은 현재 잔액 + 누적 사용량이며, 생성·충전 후 자동 갱신합니다.
- 알림 토글의 손잡이가 체크 상태에서 트랙 밖으로 나가지 않도록 수정했습니다.

### 관리자 회원관리

- `/admin/members`에서 검색·역할·상태·교단·프로필 완성도 필터와 회원 상세를 제공합니다.
- `기존 가입 회원 동기화`는 Supabase Auth의 인증 완료 계정을 페이지 단위로 조회해 앱 DB에 없는 UUID만 안전하게 추가합니다. 기존 역할·상태·이름·활동 시각·토큰은 보존하고 이메일 충돌은 자동 병합하지 않습니다.
- 상세에서는 프로필, 활동량, 토큰·결제 원장, 설교 피드백 메타데이터, 인증 상태와 감사 기록을 확인합니다. 설교 본문이나 피드백 메시지는 기본 회원관리 화면에 노출하지 않습니다.
- 설교자·전문가 역할 변경은 낙관적 버전을 검사하고, 진행 중인 피드백이 있는 전문가 강등은 차단합니다.
- 이용 정지·복구는 앱 DB에서 중앙 강제하며 알려진 세션을 폐기합니다. `SUPABASE_SERVICE_ROLE_KEY`가 있으면 상세 Auth 정보와 Supabase Auth ban 상태도 동기화하고, 재설정·인증 메일은 공개 Supabase 설정으로 요청할 수 있습니다.
- 무료 토큰 지급·회수는 결제 충전과 별도인 `admin_adjustment` 원장으로 기록합니다. 잔액·원장·조정·감사는 한 DB 트랜잭션으로 처리하고 요청 ID로 중복을 막습니다.
- 이메일 직접 수정, 결제 상태 수동 변경, 회원 영구 삭제와 사칭 로그인은 제공하지 않습니다.

### 인증·DB 요청 고착 방지

- Supabase 서버 인증 요청은 12초 안에 끝나지 않으면 권한을 부여하지 않고 실패 처리합니다. API는 프록시의 중복 인증을 건너뛰되 중앙 인증에서 `session`·`persistent` 세션 모드 쿠키를 다시 확인합니다.
- 서버리스 인스턴스의 첫 DB 요청은 최신 열, 모든 보호 테이블의 RLS, 핵심 고유 인덱스를 한 번 확인합니다. 모두 정상이면 전체 DDL/RLS 부트스트랩을 건너뜁니다.
- 실제 스키마가 부족할 때만 advisory lock 아래에서 복구하며, 일반 PostgreSQL 쿼리는 15초 취소 제한을 적용합니다. 트랜잭션의 statement·lock·idle 제한은 `set_config(..., true)`로 해당 트랜잭션에만 적용해 Supavisor transaction pool과 호환합니다.
- 배포 시 RLS 보강 스크립트도 transaction-local statement·lock·idle 제한을 사용합니다.

## 4. 핵심 코드 지도

| 영역 | 파일 | 책임 |
| --- | --- | --- |
| 설교 타입·호환 변환 | `app/_lib/sermon-types.ts` | `SermonOptions`, 단일 엔진 미러, 사용자 감정선 검증 |
| 브라우저 초안 저장 | `app/_lib/sermon-store.ts` | localStorage 저장, 이전 초안 마이그레이션 |
| 설교 옵션 UI | `app/_components/sermon-options.tsx` | 기본·구성 옵션, 기타 감정선, 단일 엔진 라디오 |
| 설교 생성 클라이언트 | `app/_lib/sermon-client.ts` | 다섯 초안 순차 요청과 재개 |
| 설교 생성 서버 | `app/api/sermons/generate/route.ts` | 검증, 생성 방식 협상, 서명, 차감, 저장 |
| 설교자 문맥 | `app/_lib/sermon-preacher-context.ts` | 인증 프로필의 비연락 신학·사역 문맥만 서버에서 조회 |
| 프로필 옵션 | `app/_lib/profile-options.ts`, `app/my/profile-form.tsx` | 교단·신학 종속 선택과 개인 설정 |
| 후속 자료 생성 | `app/_lib/sermon-resources.ts`, `app/api/sermon-resources/route.ts` | 스터디·사역 활용 생성, 소유권·공정 이용 검증 |
| AI 설정 해석 | `app/_lib/managed-ai-engines.ts` | 세 등급 설정 조회, 키 복호화·환경 폴백 |
| 관리자 AI 안전 응답 | `app/_lib/admin-ai-settings-view.ts`, `app/admin/ai`, `app/api/admin/ai-settings` | 서버 최초 로드, strict DB read, 키 비노출 view, 15초 재시도·저장 |
| 공급자 요청 | `app/_lib/ai-provider-adapters.ts` | 엔진별 URL·헤더·본문 변환 |
| AI 모델 목록 | `app/_lib/ai-model-catalog.ts` | 모델 API 요청과 응답 정규화 |
| 사용자 지정 URL 보안 | `app/_lib/ai-custom-endpoint.ts` | 공개 HTTP/HTTPS 주소·포트 및 DNS 검증 |
| 토큰 가격 공식 | `app/_lib/sermon-token-pricing.ts` | 엔진·분량·대지 수 기반 생성 1회 비용 |
| 토큰 원장 | `app/_lib/token-wallet.ts` | 비용, 차감, 환불, 충전 완료 |
| 토큰 화면 갱신 | `app/_lib/token-wallet-events.ts` | 생성·충전 후 헤더 잔액 갱신 이벤트 |
| 인증 | `app/_lib/auth-user.ts`, `app/_lib/supabase/*`, `proxy.ts` | SSR 세션·세션 모드 검증, 12초 Supabase 제한, 관리자 판별 |
| 회원관리 | `app/admin/members`, `app/api/admin/members`, `app/_lib/admin-member-auth.ts`, `app/_lib/admin-member-sync.ts` | Auth 디렉터리 동기화, 목록·상세, 역할·정지·무료 토큰·인증 지원·감사 |
| DB 호환층 | `db/index.ts` | D1 형태 쿼리를 PostgreSQL로 변환·실행, RLS·인덱스 readiness, 쿼리·transaction 제한 |
| DB 스키마 | `db/schema.ts`, `drizzle/` | 테이블 정의와 Sites/D1 마이그레이션 |
| 전체 회귀 검사 | `tests/rendered-html.test.mjs`, `tests/auth-member-security.test.mjs`, `tests/admin-members-security.test.mjs` | 화면·생성·결제·인증·회원관리 보안 회귀 방지 |

## 5. 환경 변수

실제 값은 호스팅 비밀 설정에서 관리하고 문서나 Git에 남기지 마세요.

### 운영 필수

| 변수 | 용도 |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase 프로젝트 URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | 브라우저용 공개 키; 이전 `ANON_KEY`도 폴백 지원 |
| `NEXT_PUBLIC_SITE_URL` | `https://www.sermon-ai.shop` |
| `POSTGRES_URL` 또는 `POSTGRES_URL_NON_POOLING` | PostgreSQL 연결 및 빌드 시 RLS 확인 |
| `ADMIN_EMAILS` | 쉼표로 구분한 관리자 이메일 |
| `SUPABASE_SERVICE_ROLE_KEY` | 상세 Auth 조회·ban 동기화용 서버 전용 키; 브라우저 노출 금지 |
| `AI_SETTINGS_ENCRYPTION_KEY` | 관리자 저장 API 키 암호화용 32자 이상 비밀값 |

`SCRIPTURE_NORMALIZATION_SECRET`은 성경 본문 정규화 승인 토큰 서명용 32자 이상 선택 비밀값입니다. 없으면 `AI_SETTINGS_ENCRYPTION_KEY` → `SUPABASE_SERVICE_ROLE_KEY` → 선택 공급자 키 순으로 폴백하지만, 역할 분리를 위해 운영에서는 별도 값을 권장합니다. `VERCEL_OIDC_TOKEN`처럼 CLI가 임시 발급한 기기·세션 토큰은 다른 컴퓨터로 복사하지 않습니다.

### AI 공급자 폴백

- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `GEMINI_API_KEY`
- `OPENROUTER_API_KEY`
- `DEEPSEEK_API_KEY`
- `CUSTOM_AI_API_KEY`
- `OPENAI_MODEL`: 기본 OpenAI 모델 재정의용 선택값
- `OPENAI_REASONING_EFFORT`: OpenAI 추론 강도 재정의용 선택값

### 포트원 결제

- `PORTONE_STORE_ID`
- `PORTONE_CHANNEL_KEY`
- `PORTONE_API_SECRET`
- `PORTONE_WEBHOOK_SECRET`

네 값이 모두 있어야 실제 토큰 충전 결제가 활성화됩니다. 설교 생성 토큰 차감은 결제 설정과 별도로 동작합니다. 웹훅은 `/api/portone/webhook`입니다.

### 선택·로컬 전용

- `SERMON_LOCAL_MODE=true`: 로컬 사용자 폴백
- `SERMON_LOCAL_ADMIN=true`: 로컬 폴백 사용자를 관리자로 취급
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`: 과거 Stripe 호환 경로용

환경 변수의 **이름**은 `.env.example`, 실제 운영 **값**은 Vercel/Sites 비밀 설정을 기준으로 합니다. `.env.local`은 Git에서 제외되지만 그대로 복사하거나 전체 내용을 출력하지 않습니다. Sites 런타임 값과 D1/R2 바인딩은 기존 프로젝트가 소유하므로 새 프로젝트 생성이나 임의 재입력으로 대체하지 않습니다.

## 6. 로컬 실행과 검증

```powershell
npm ci
npm run dev
```

문서만 바꿨다면 최소한 아래를 확인합니다.

```powershell
git diff --check
git status --short
```

애플리케이션 코드를 바꿨다면 아래 전체 검증을 실행합니다. 현재 기대 결과는 세 테스트 파일 합계 79개 통과입니다.

```powershell
node node_modules/typescript/bin/tsc --noEmit --incremental false
node --test tests/auth-member-security.test.mjs tests/admin-members-security.test.mjs tests/rendered-html.test.mjs
npm run lint
npm run build
npx vinext build
```

`npm test`는 Next.js 빌드와 `rendered-html`만 실행하므로 관리자 인증·회원관리 보안 테스트까지 포함한 전체 검증의 대체물이 아닙니다. `npm run build`는 DB URL이 있으면 `scripts/secure-supabase-tables.mjs`를 먼저 실행해 앱 테이블의 RLS를 확인·적용합니다. 운영 DB를 대상으로 빌드할 때는 의도한 프로젝트인지 먼저 확인하세요.

### DB 스키마를 바꿀 때 반드시 함께 수정할 곳

이 프로젝트는 Sites/D1 이력과 Vercel/PostgreSQL 런타임 계약을 함께 유지합니다. 한쪽만 고치면 다른 배포나 콜드 스타트에서 장애가 납니다.

1. `db/schema.ts`의 논리 스키마를 수정합니다.
2. `npm run db:generate`로 `drizzle/*.sql`, `drizzle/meta/*`, journal을 생성하고 SQL 범위를 직접 검토합니다.
3. `db/index.ts`의 `schemaStatements`, `requiredSchemaColumns`, 필요한 `requiredUniqueIndexNames`, `protectedTableNames`를 함께 갱신합니다.
4. 새 보호 테이블이면 `scripts/secure-supabase-tables.mjs`의 `protectedTables`에도 추가합니다.
5. PostgreSQL의 기존 데이터 보정은 idempotent SQL로 만들고 advisory-lock bootstrap 안에서 실행되게 합니다. 런타임 fast-path가 새 버전을 잘못 최신으로 판단하지 않도록 readiness 조건을 반드시 추가합니다.
6. RLS, 고유 인덱스, 원장·감사 idempotency 회귀 테스트를 추가한 뒤 전체 검증을 실행합니다.

`drizzle/`은 Sites/D1 이력이며 운영 PostgreSQL에 자동 적용하는 migration runner가 아닙니다. 운영에 `drizzle push`·`drizzle migrate`를 임의 실행하지 않습니다. 운영 DB에 수동 SQL을 먼저 적용하고 소스 계약을 나중에 맞추는 방식도 금지합니다. 특히 회원 삭제, 이메일 변경, 지갑 잔액 직접 수정과 결제 상태 수동 변경은 기존 무결성·감사 원장을 깨뜨릴 수 있습니다. 롤백 시 코드를 이전 커밋으로 돌려도 additive DB 스키마는 자동으로 사라지지 않으므로 DROP·데이터 삭제로 맞추지 않습니다.

### 설교 생성 수동 점검

1. `/sermon/options`에서 제목·분량·유형·구성이 기본 옵션, 대상·청중 상황·감정선이 구성 옵션에 있는지 확인합니다.
2. 청중 상황과 감정선의 `기타`에 2~40자의 값을 입력하고 저장 후 옵션 배지에 실제 문구가 표시되는지 봅니다.
3. AI 엔진을 한 번 선택해 다섯 초안이 같은 등급으로 순서대로 완료되는지 확인합니다.
4. 생성 중 `생성 중지`를 누른 뒤 완성된 다음 번호부터 이어지는지 확인합니다.
5. custom OpenAI 호환 엔진은 조각 진행률이, 나머지 엔진은 초안 번호 진행률이 표시되는지 확인합니다.
6. 완성 설교 저장 후 `/study`와 `/ministry`에서 해당 설교 ID가 그대로 선택되고 자료가 생성되는지 확인합니다.

## 7. 배포 절차

배포 전 `git status --short`가 비어 있어야 하며, 검증한 HEAD를 먼저 Sites 소스 저장소 `main`에 푸시합니다. 단기 자격은 per-command HTTP 헤더로만 사용하고 원격 URL·credential helper·파일에 남기지 않습니다. Vercel과 Sites에는 반드시 같은 HEAD를 배포합니다.

### Vercel / 대표 도메인

1. 전체 테스트, ESLint, TypeScript, Next.js 빌드를 통과시킵니다.
2. `.vercel/project.json`이 기존 `sermon-guide-studio-kr`를 가리키는지 확인합니다. 없으면 새 프로젝트를 만들지 말고 기존 프로젝트에 link합니다.
3. 연결된 프로젝트에서 다음을 실행합니다.

```powershell
npx --yes vercel@latest deploy --prod --yes
```

4. 출력에 `https://www.sermon-ai.shop` 별칭이 연결됐는지 확인합니다.
5. 다음 응답을 확인합니다.

```text
https://sermon-ai.shop/                              → 308, www로 이동
https://www.sermon-ai.shop/                          → 200
https://www.sermon-ai.shop/admin/ai                  → 비로그인 307, /login으로 이동
https://www.sermon-ai.shop/api/admin/ai-settings     → 비로그인 401, 장기 대기 없음
```

6. 실제 관리자 계정으로 `/admin/ai`를 열어 세 엔진 카드가 즉시 보이는지, 모델 ID 조회와 저장 결과가 버튼 근처에 표시되는지 확인합니다. 오류 카드가 나오면 `다시 시도`가 15초 안에 결과를 돌려주는지 확인합니다.

### Sites

`.openai/hosting.json`이 있으므로 반드시 기존 `project_id`를 재사용합니다. 새 사이트를 만들거나 ID·slug를 바꾸지 마세요.

1. 같은 HEAD에서 `npx vinext build`를 실행해 `dist/server/index.js`를 생성합니다.
2. 현재 설치된 Sites hosting skill의 `package-site.sh`로 `dist/`, `.openai/hosting.json`, `drizzle/`을 패키징합니다. 플러그인 캐시 버전이 바뀔 수 있으므로 이 문서의 고정 절대 경로를 만들지 않습니다.
3. 원격 `main`에 푸시한 정확한 HEAD SHA와 같은 빌드 archive로 Sites 버전 하나를 저장합니다.
4. owner-only 상태가 확인되면 private 배포를 사용하고 완료될 때까지 상태를 확인합니다.
5. 성공 URL은 <https://sermon-guide-studio-kr.nettman001.chatgpt.site>입니다. private Sites 배포는 비인증 요청에 `401`을 반환하는 것이 정상입니다.

배포 후 `git rev-parse HEAD`, Sites 저장 버전의 `source.commit_sha`, Vercel에 올린 소스가 같은지 기록합니다. 실패한 빌드나 저장만 된 Sites 버전을 운영 완료로 보고하지 않습니다.

Sites는 소스·빌드 호환 확인용 private 보조 배포이며 현재 운영 환경 변수는 Vercel과 동등하지 않습니다. Supabase/PostgreSQL 인증·데이터·AI 기능의 최종 운영 검증 대상은 `www.sermon-ai.shop`입니다. Sites를 public로 바꾸거나 운영 대체본으로 간주하지 않습니다.

### 긴급 롤백 원칙

- Vercel은 이전 Ready 배포의 소스 SHA와 환경을 확인한 뒤 promote/재배포합니다. DB를 함께 되돌리거나 테이블·컬럼을 삭제하지 않습니다.
- Sites는 저장된 이전 버전을 재배포할 수 있지만, 버전 31(`c310b5f`)은 관리자 AI 로딩 고착 수정 전이므로 서비스 복구를 위한 짧은 임시 수단일 뿐입니다.
- 결제·토큰·회원 상태 변경이 포함된 릴리스는 코드 롤백 전에 원장·감사·웹훅 영향부터 확인합니다.

## 8. 데이터와 보안 규칙

- 서버는 검증한 Supabase 사용자 UUID만 신뢰합니다.
- 브라우저가 보낸 AI 엔진 설정이나 API 키는 생성·수정 API에서 거부합니다.
- 내장 AI 엔진은 고정 공식 호스트만 사용하며 리디렉션을 따르지 않습니다.
- 사용자 지정 AI URL은 공개 HTTP/HTTPS 주소와 DNS를 검사해 사설망 접근을 막습니다.
- 관리자 저장 API 키는 AES-GCM으로 암호화하며 암호화 키 자체는 DB에 저장하지 않습니다.
- 토큰 차감·충전은 서버 원장과 고유 참조 ID를 사용해 중복을 방지합니다.
- 포트원 결제 결과는 브라우저 응답만 믿지 않고 서버가 `PAID` 상태와 금액을 재검증합니다.
- 회원 정지와 폐기된 세션은 모든 인증 경로에서 중앙 검사하며 운영 DB 장애 시 접근을 허용하지 않습니다.
- 회원 역할·상태·인증 지원·무료 토큰 작업은 관리자 사유와 고유 요청 ID를 감사 원장에 남깁니다.
- 비밀값, 전체 환경 변수 출력, 인증 토큰, 사용자 개인정보를 로그나 이슈에 붙이지 마세요.

## 9. 알려진 제약과 다음 작업 후보

1. **현재 PC의 Git 메타데이터는 복구용이며 비이식성:** 현재 폴더에서는 보존 디렉터리를 삭제·수리하지 말고, 새 PC에서는 반드시 짧은 비동기화 경로에 fresh clone합니다. 원격 자격 발급이 일시적으로 불가능할 때만 현재 PC에서 `git bundle create <안전한-외부경로> main`으로 `main` 한 브랜치만 내보냅니다. 깨진 refs가 섞일 수 있으므로 `--all`은 사용하지 않습니다.
2. **Sites 원격 자격:** private 원격은 매번 단기 credential이 필요합니다. clone/fetch/push 명령에만 헤더로 전달하고 Git 설정이나 remote URL에 저장하지 않습니다.
3. **DB 연결 한도:** 일반 쿼리는 15초 취소와 트랜잭션 서버 한도를 사용하지만 postgres.js의 active-query 취소는 best-effort입니다. 인스턴스당 커넥션 풀은 `POSTGRES_POOL_MAX`(기본 4, 1~8 강제)로 조절합니다. 과거 `max: 1`에서는 트랜잭션이 유일한 커넥션을 점유하는 동안 같은 인스턴스의 형제 API 요청이 큐에서 15초 데드라인에 걸려 503(`account_store_unavailable`)이 재현되었습니다. 값을 올리기 전에 `POSTGRES_URL`이 Supavisor transaction pooler를 가리키는지 반드시 확인하고, 직결(5432)이라면 2 이하로 유지합니다. 반복적인 pool 고착이 재현되면 공유 역할을 바꾸지 말고 전용 앱 DB role의 서버 `statement_timeout`과 pool 복구 전략을 별도 설계합니다.
4. **이메일 알림:** 브라우저 알림과 전송 큐는 있으나 실제 이메일 제공자 연결은 별도 운영 작업입니다.
5. **실계정 E2E:** 자동 테스트는 소스·서버 로직 중심입니다. 인증, 관리자 화면과 실제 AI 공급자는 운영 비밀값이 필요한 별도 스모크 테스트가 필요합니다.
6. **결제:** 포트원/KCP 신청과 운영 계약이 완료되지 않았으므로 결제 기능은 아직 운영 대상으로 간주하지 않습니다.

## 10. 장애 시 빠른 확인 순서

### 모델 목록이 안 나올 때

1. `/admin/ai`가 관리자 계정인지 확인합니다.
2. 사용자 지정 URL에서 파생된 `/models` 주소가 공개 HTTP/HTTPS로 접근 가능한지 확인합니다.
3. API 키가 필요 없는 서버라면 키를 비우고, 필요한 서버라면 새 키를 입력해 다시 조회합니다.
4. `/api/admin/ai-settings/models` 응답 메시지를 확인합니다. 키를 로그에 출력하지 마세요.

### 관리자 AI 화면이 설정을 못 불러올 때

1. 운영 별칭이 최신 배포를 가리키는지, 실제 관리자 계정의 이메일이 `ADMIN_EMAILS`에 있는지 확인합니다.
2. 화면은 서버에서 최초 설정을 함께 전달하므로 과거의 `관리자 AI 설정을 불러오는 중입니다…` 문구에 무기한 머물러서는 안 됩니다. 실패하면 오류 카드와 `다시 시도` 버튼이 보여야 합니다.
3. `/api/admin/ai-settings`의 상태를 확인합니다. `401`은 로그인/세션 모드, `403`은 관리자 권한, `503`은 Supabase·PostgreSQL·strict 설정 조회 문제입니다.
4. strict DB read는 오류를 환경 기본값으로 가장하지 않습니다. 저장 장애 중 PUT을 반복하거나 DB 값을 수동 덮어쓰지 말고 가용성을 먼저 복구합니다.
5. 브라우저 요청·Supabase·DB에 각각 제한이 있으므로 15초 안팎에 오류로 전환되어야 합니다. 계속 무기한 대기하면 해당 Vercel 배포 로그와 DB pool 상태를 함께 확인합니다.

### 인증된 화면이 오래 멈출 때

1. 콜드 인스턴스는 최신 필수 컬럼, 보호 테이블 전체의 RLS, 핵심 고유 인덱스를 먼저 확인하고 모두 정상이면 요청 시점의 전체 DDL 부트스트랩을 생략합니다.
2. Supabase 인증 요청은 12초, 일반 PostgreSQL 쿼리 취소는 15초 제한입니다. 일반 batch는 statement 15초·lock 5초·idle 30초, 외부 Auth 동기화 advisory transaction은 idle 60초를 사용합니다.
3. readiness가 실패할 때만 스키마 복구 transaction을 실행합니다. 운영 로그에 매 요청마다 다수의 `already exists, skipping` NOTICE가 반복되면 fast-path 조건 또는 실제 스키마 drift를 점검합니다.
4. 계속 실패하면 Supabase Auth, PostgreSQL/Supavisor 가용성, Vercel 함수 로그를 확인하되 환경 변수 전체나 연결 문자열을 출력하지 않습니다.
5. 인증 503의 원인은 Vercel 함수 로그의 구조화 경고로 판별합니다. `[auth-access]`는 중앙 인증 실패로 `scope`(`identity`=Supabase 인증, `account_store`=DB 계정 조회), `stage`, `elapsedMs`, PostgreSQL `code`만 남기고, `[db]`는 15초 데드라인 초과(`deadline_exceeded`)와 쿼리 실패(`query_failed`)를 남깁니다. `account_store` + `57014` + `elapsedMs≈15000`은 커넥션 큐 대기 취소(→ `POSTGRES_POOL_MAX` 확인), `53300`은 연결 고갈(→ 풀 축소·pooler 전환), `55P03`은 부트스트랩 advisory lock 경합(→ readiness 실측), `identity` + 12초 부근은 Supabase Auth 지연입니다. API 503 응답 본문의 `code` 필드(`identity_unavailable`/`account_store_unavailable`)와 브라우저 콘솔의 `[tokens] request failed`로도 같은 판별이 가능합니다. 두 경고 모두 비밀값·개인정보·SQL·바인드 값은 기록하지 않습니다.

### 설교 생성이 중간에 멈출 때

1. 사용자 토큰 잔액과 선택한 엔진·분량·대지 수의 예상 비용을 확인합니다.
2. 관리자에서 해당 등급 엔진이 활성화됐는지 확인합니다.
3. 생성 오류 메시지가 새 묶음을 요구하지 않으면 같은 작업에서 재시도합니다.
4. `sermon_generation_runs`, `sermon_generation_items`, `sermon_generation_claims`의 실행 ID와 순서를 확인합니다.

### 로그인 콜백이 실패할 때

1. `NEXT_PUBLIC_SITE_URL`과 Supabase Site URL을 확인합니다.
2. Supabase Redirect URL에 `/auth/callback` 운영 주소가 허용됐는지 확인합니다.
3. 브라우저에 과거 장치 세션 쿠키가 남아 있지 않은지 확인합니다.

## 11. 완료 정의

작업을 넘길 때 다음을 함께 남기세요.

- 변경한 사용자 동작과 영향 범위
- 변경한 핵심 파일
- 실행한 테스트와 결과
- DB·환경 변수 변경 여부
- 배포 주소와 실제 확인 결과
- 남은 문제, 재현 조건, 안전한 다음 조치
- 원격 `main`, Vercel, Sites가 가리키는 동일한 HEAD SHA
- `git status --short`가 빈 clean 작업 트리인지 여부

현재 인수인계 시점에는 미커밋 애플리케이션 변경이 없고, 운영 기능 기준 `721a98c`에서 관리자 AI 설정 무한 로딩 수정까지 배포됐습니다. 이 문서와 `.env.example`을 갱신하는 후속 커밋은 실행 동작을 바꾸지 않습니다. 새 담당자는 원격 `main` 최신 HEAD를 clone한 뒤 이 문서의 새 컴퓨터 체크리스트부터 진행하세요.
