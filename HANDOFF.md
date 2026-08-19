# 로고스AI 개발·운영 인수인계

최종 정리일: 2026-08-19 (Asia/Seoul)

이 문서는 다음 담당자가 현재 기능을 훼손하지 않고 개발, 검증, 배포를 바로 이어가기 위한 기준 문서입니다. 기능 설명은 `README.md`, 최초 요구사항은 `설계.json`, 실제 동작의 최종 기준은 현재 소스와 `tests/rendered-html.test.mjs`입니다.

## 0. 가장 먼저 확인할 것

> **이번 변경의 시작 기준선은 Sites 버전 27 및 Sites 원격 `main`과 일치한 커밋 `8d0b4918b9428f9857c7cc6db7883691f517710d`입니다.** 로컬 `origin/main` 표시는 손상된 보존 ref 때문에 낡을 수 있으므로, 강제 reset이나 merge로 맞추지 마세요. Google Drive의 Git 디렉터리 제약 때문에 `.git`은 별도 보존 메타데이터를 가리키는 gitfile입니다.

- 두 보존 디렉터리를 임의로 삭제하거나 `.git`을 일반 폴더로 다시 복사하지 마세요.
- 작업 전 `git status`, `git log -1`, `git remote -v`로 기준선을 확인하세요.
- `.env*`, `.vercel/`, 빌드 산출물과 API 키는 커밋하면 안 됩니다.
- Google Drive 경로에서 `node_modules` 링크가 깨질 수 있습니다. 설치·빌드 오류가 나면 소스를 로컬 비동기화 폴더로 복사한 뒤 `npm ci`로 다시 검증하세요.

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
| 최종 검증 | 테스트 68개 통과, ESLint·TypeScript·Next.js·vinext 프로덕션 빌드 통과 |

대표 운영 주소와 Sites 배포본은 2026-08-18에 같은 소스로 배포했습니다. 기능 수정 후에는 두 배포 대상이 서로 다른 버전이 되지 않도록 확인하세요.

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
| 공급자 요청 | `app/_lib/ai-provider-adapters.ts` | 엔진별 URL·헤더·본문 변환 |
| AI 모델 목록 | `app/_lib/ai-model-catalog.ts` | 모델 API 요청과 응답 정규화 |
| 사용자 지정 URL 보안 | `app/_lib/ai-custom-endpoint.ts` | 공개 HTTP/HTTPS 주소·포트 및 DNS 검증 |
| 토큰 가격 공식 | `app/_lib/sermon-token-pricing.ts` | 엔진·분량·대지 수 기반 생성 1회 비용 |
| 토큰 원장 | `app/_lib/token-wallet.ts` | 비용, 차감, 환불, 충전 완료 |
| 토큰 화면 갱신 | `app/_lib/token-wallet-events.ts` | 생성·충전 후 헤더 잔액 갱신 이벤트 |
| 인증 | `app/_lib/auth-user.ts`, `app/_lib/supabase/*` | SSR 세션 검증, 관리자 판별 |
| DB 호환층 | `db/index.ts` | D1 형태 쿼리를 PostgreSQL로 변환·실행 |
| DB 스키마 | `db/schema.ts`, `drizzle/` | 테이블 정의와 Sites/D1 마이그레이션 |
| 전체 회귀 검사 | `tests/rendered-html.test.mjs` | 보안·인증·생성·결제·접근성 회귀 방지 |

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
| `AI_SETTINGS_ENCRYPTION_KEY` | 관리자 저장 API 키 암호화용 32자 이상 비밀값 |

### AI 공급자 폴백

- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `GEMINI_API_KEY`
- `OPENROUTER_API_KEY`
- `DEEPSEEK_API_KEY`
- `CUSTOM_AI_API_KEY`
- `OPENAI_MODEL`은 기본 OpenAI 모델 재정의용 선택값입니다.

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

## 6. 로컬 실행과 검증

```bash
npm ci
npm run dev
```

변경 후 최소 검증:

```bash
node --test tests/rendered-html.test.mjs
npm run build
```

전체 검증:

```bash
npm test
npm run lint
```

`npm run build`는 DB URL이 있으면 `scripts/secure-supabase-tables.mjs`를 먼저 실행해 앱 테이블의 RLS를 확인·적용합니다. 운영 DB를 대상으로 빌드할 때는 의도한 프로젝트인지 먼저 확인하세요.

### 설교 생성 수동 점검

1. `/sermon/options`에서 제목·분량·유형·구성이 기본 옵션, 대상·청중 상황·감정선이 구성 옵션에 있는지 확인합니다.
2. 청중 상황과 감정선의 `기타`에 2~40자의 값을 입력하고 저장 후 옵션 배지에 실제 문구가 표시되는지 봅니다.
3. AI 엔진을 한 번 선택해 다섯 초안이 같은 등급으로 순서대로 완료되는지 확인합니다.
4. 생성 중 `생성 중지`를 누른 뒤 완성된 다음 번호부터 이어지는지 확인합니다.
5. custom OpenAI 호환 엔진은 조각 진행률이, 나머지 엔진은 초안 번호 진행률이 표시되는지 확인합니다.
6. 완성 설교 저장 후 `/study`와 `/ministry`에서 해당 설교 ID가 그대로 선택되고 자료가 생성되는지 확인합니다.

## 7. 배포 절차

### Vercel / 대표 도메인

1. 테스트와 `npm run build`를 통과시킵니다.
2. 연결된 프로젝트에서 다음을 실행합니다.

```bash
npx vercel deploy --prod --yes
```

3. 출력에 `https://www.sermon-ai.shop` 별칭이 연결됐는지 확인합니다.
4. 다음 주소를 확인합니다.

```text
https://sermon-ai.shop/sermon/options   → www로 이동, HTTP 200
https://www.sermon-ai.shop/sermon/options
```

### Sites

`.openai/hosting.json`이 있으므로 Sites 배포 시에는 해당 `project_id`를 재사용합니다. `npx vinext build`로 `dist/server/index.js`를 만든 뒤 Sites 호스팅 절차에 따라 같은 소스를 저장·배포합니다. 새 사이트를 만들거나 `project_id`를 바꾸지 마세요.

## 8. 데이터와 보안 규칙

- 서버는 검증한 Supabase 사용자 UUID만 신뢰합니다.
- 브라우저가 보낸 AI 엔진 설정이나 API 키는 생성·수정 API에서 거부합니다.
- 내장 AI 엔진은 고정 공식 호스트만 사용하며 리디렉션을 따르지 않습니다.
- 사용자 지정 AI URL은 공개 HTTP/HTTPS 주소와 DNS를 검사해 사설망 접근을 막습니다.
- 관리자 저장 API 키는 AES-GCM으로 암호화하며 암호화 키 자체는 DB에 저장하지 않습니다.
- 토큰 차감·충전은 서버 원장과 고유 참조 ID를 사용해 중복을 방지합니다.
- 포트원 결제 결과는 브라우저 응답만 믿지 않고 서버가 `PAID` 상태와 금액을 재검증합니다.
- 비밀값, 전체 환경 변수 출력, 인증 토큰, 사용자 개인정보를 로그나 이슈에 붙이지 마세요.

## 9. 알려진 제약과 다음 작업 후보

1. **Google Drive Git 메타데이터:** `.git` gitfile과 보존 디렉터리 구조를 유지해야 합니다.
2. **이메일 알림:** 브라우저 알림과 전송 큐는 있으나 실제 이메일 제공자 연결은 별도 운영 작업입니다.
3. **실계정 E2E:** 자동 테스트는 소스·서버 로직 중심입니다. 인증과 실제 AI 공급자는 운영 비밀값이 필요한 별도 스모크 테스트가 필요합니다.
4. **결제:** 포트원/KCP 신청과 운영 계약이 완료되지 않았으므로 결제 기능은 아직 운영 대상으로 간주하지 않습니다.

## 10. 장애 시 빠른 확인 순서

### 모델 목록이 안 나올 때

1. `/admin/ai`가 관리자 계정인지 확인합니다.
2. 사용자 지정 URL에서 파생된 `/models` 주소가 공개 HTTP/HTTPS로 접근 가능한지 확인합니다.
3. API 키가 필요 없는 서버라면 키를 비우고, 필요한 서버라면 새 키를 입력해 다시 조회합니다.
4. `/api/admin/ai-settings/models` 응답 메시지를 확인합니다. 키를 로그에 출력하지 마세요.

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
