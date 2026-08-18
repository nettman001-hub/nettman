# 설교가이드

목회자가 본문과 설교 조건을 입력하면 다섯 가지 설교 방향을 비교하고, 선택한 원고를 다듬어 저장·상담·내보내기까지 이어갈 수 있는 웹 애플리케이션입니다. 구현 범위는 `설계.json`의 `informationArchitecture`를 라우트로, `requirements[].features[].specifications`를 작업 단위로 삼았습니다.

## 주요 흐름

- `/sermon` → `/sermon/options` → `/sermon/input` → `/sermon/alternatives` → `/sermon/edit` → `/sermon/complete`: 설교 생성, 비교, 수정, 저장
- `/history`, `/history/[id]`: 저장한 설교 검색, 열람, PDF·Word 내보내기
- `/consult`, `/consult/[id]`: 전문가 상담 신청과 메시지
- `/expert`, `/expert/[id]`: 전문가 배정, 검토, 답변, 상담 완료
- `/my`, `/notifications`: 프로필과 알림 설정
- `/login`, `/signup`, `/forgot-password`, `/verify-email`, `/reset-password`: Supabase 이메일/비밀번호 및 Google OAuth 인증

## 실행

Node.js 22.13 이상이 필요합니다.

```bash
npm install
npm run dev
npm run lint
npm test
```

`npm test`는 프로덕션 빌드와 핵심 렌더링·라우트·스키마 검사를 함께 수행합니다.

## 데이터와 인증

- Vercel 배포본은 Vercel Marketplace로 연결한 Supabase PostgreSQL에 설교, 설정, 상담 데이터를 저장합니다.
- Supabase Auth의 이메일/비밀번호 가입·이메일 인증·비밀번호 재설정과 Google OAuth 로그인을 사용합니다. 같은 검증 이메일의 Google 로그인은 동일 사용자에 자동 연결됩니다.
- 서버는 SSR 쿠키의 JWT 서명을 검증한 Supabase 사용자 UUID만 신뢰하며, 앱 데이터 테이블에는 RLS를 켜서 브라우저의 Data API 직접 접근을 차단합니다.
- 로그인 유지를 선택하면 최대 7일, 선택하지 않으면 현재 브라우저 세션 동안 유지됩니다.
- 기존 D1 마이그레이션은 `drizzle/`에 보존되어 있으며, 서버의 PostgreSQL 호환층이 기존 쿼리 계약을 유지합니다.
- 로컬 개발에서도 데모 사용자와 로컬 저장소 폴백을 사용해 전체 흐름을 확인할 수 있습니다.

로컬과 Vercel에 다음 공개 인증 환경 변수가 필요합니다. `service_role` 키는 브라우저 환경 변수로 등록하면 안 됩니다.

```text
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
NEXT_PUBLIC_SITE_URL=https://www.sermon-ai.shop
```

Supabase Auth의 Site URL과 Redirect URL에는 프로덕션 `/auth/callback` 및 필요한 로컬/미리보기 주소를 허용해야 합니다. 운영 이메일 인증·재설정은 Supabase 기본 발송 제한에 의존하지 않도록 별도 SMTP 연결을 권장합니다.

## Vercel 배포

Vercel CLI로 프로젝트를 연결한 뒤 프로덕션 배포할 수 있습니다.

```bash
npx vercel --prod
```

AI 엔진은 사용자별 설정이 아니라 관리자 전역 설정입니다. 관리자 이메일은 서버 환경 변수 `ADMIN_EMAILS`에 쉼표로 구분해 등록하고, 공급자 API 키는 해당 배포 환경의 비밀 변수로만 관리합니다. 브라우저와 데이터베이스에는 API 키를 저장하지 않습니다.

## AI 생성

관리자는 `/admin/ai`에서 모든 사용자에게 공통으로 적용할 AI 엔진, API 주소, 모델과 추론 강도를 설정할 수 있습니다. 일반 사용자의 `/my`에는 AI 설정이 없고, 생성·수정 API도 브라우저가 보낸 엔진·모델·키를 거부합니다.

관리자가 선택할 수 있는 엔진은 다음과 같습니다.

- OpenAI Responses API
- Anthropic Claude Messages API
- Google Gemini Interactions API
- OpenRouter Chat Completions API
- 기타 공개 HTTPS OpenAI Responses 호환 API

엔진을 고른 뒤 다음 값을 전역으로 설정할 수 있습니다.

- 엔진별 공식 API URL(보안상 읽기 전용) 또는 호환 엔진의 직접 URL (`/responses` 경로)
- 모델 ID
- 해당 엔진이 지원하는 추론 강도

엔진·URL·모델·추론 강도는 전역 설정으로 데이터베이스에 저장되고, API 키는 공급자별 서버 비밀 변수에서만 읽습니다. 내장 엔진은 각 공급자의 공식 호스트로만 키를 전송하고 리디렉션을 따르지 않습니다. 사용자 지정 URL은 공개 도메인과 DNS 주소를 확인한 뒤 호출합니다. 관리자 엔진의 인증·한도·응답 오류는 로컬 결과로 조용히 대체하지 않고 사용자에게 표시합니다.

공급자별 구조화 출력 형식과 인증 헤더는 서버 어댑터가 변환합니다. Gemini 요청은 저장을 끄고, OpenRouter 요청은 구조화 출력 파라미터를 지원하는 공급자만 사용하도록 강제합니다. 모델별 기능과 비용은 공급자 정책에 따라 달라질 수 있습니다.

```text
ADMIN_EMAILS=admin@example.com
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-5.6   # 선택 사항
ANTHROPIC_API_KEY=...
GEMINI_API_KEY=...
OPENROUTER_API_KEY=...
DEEPSEEK_API_KEY=...
CUSTOM_AI_API_KEY=...
```

알림은 브라우저 알림과 D1 전송 큐까지 구현되어 있습니다. 실제 이메일 발송은 운영 환경에서 선택한 메일 제공자를 큐 소비자에 연결해야 합니다.

## 토큰 결제

토큰 충전은 포트원 V2와 NHN KCP 채널을 사용합니다. 1,000원당 200토큰의 일회성
결제이며 신용·체크카드, 카카오페이, 네이버페이를 지원합니다. 브라우저 결제 결과만
신뢰하지 않고 서버가 포트원 REST API에서 `PAID` 상태와 원화 결제 금액을 다시 확인한
뒤 토큰을 적립합니다.

로컬과 운영 환경에 다음 값을 설정합니다.

```text
PORTONE_STORE_ID=store-...
PORTONE_CHANNEL_KEY=channel-key-...
PORTONE_API_SECRET=...
PORTONE_WEBHOOK_SECRET=whsec_...
```

포트원 콘솔에서 같은 KCP 채널에 카드와 카카오페이·네이버페이 허브형 간편결제를
활성화하고, 최신 웹훅 주소를 `https://<서비스-도메인>/api/portone/webhook`으로
등록해야 합니다. API 시크릿과 웹훅 시크릿은 브라우저 환경 변수에 등록하지 않습니다.
