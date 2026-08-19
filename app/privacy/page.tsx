import type { Metadata } from "next";
import {
  LegalDocument,
  type LegalSection,
} from "@/app/_components/legal-document";

export const metadata: Metadata = {
  title: { absolute: "개인정보처리방침 | 로고스AI" },
  description: "로고스AI가 처리하는 정보와 이용 목적, 저장 위치 및 이용자 선택권을 안내합니다.",
  alternates: { canonical: "/privacy" },
};

const sections: readonly LegalSection[] = [
  {
    id: "scope",
    title: "적용 범위와 기본 원칙",
    content: (
      <>
        <p>
          이 개인정보처리방침은 <strong>www.sermon-ai.shop</strong>에서 제공되는
          로고스AI 웹 서비스에 적용됩니다. 로고스AI는 서비스 제공에 필요한
          범위에서 정보를 처리하고, 광고 판매를 목적으로 개인정보를 처리하지 않습니다.
        </p>
        <p>
          아래 내용은 현재 서비스에서 실제로 제공하는 회원 인증, 설교 생성·저장,
          설교 피드백, 스터디·사역 활용, 알림 설정, 관리자 AI 엔진 설정 및 토큰 충전 기능을 기준으로 합니다.
        </p>
      </>
    ),
  },
  {
    id: "data-and-purpose",
    title: "처리하는 정보와 이용 목적",
    content: (
      <>
        <h3>계정과 인증</h3>
        <ul>
          <li>Supabase 사용자 식별자, 이메일 주소, 이름과 계정 역할</li>
          <li>이메일·비밀번호 가입, 이메일 확인, 비밀번호 재설정 및 Google 로그인 처리</li>
          <li>
            비밀번호 인증은 Supabase Auth가 담당하며, 로고스AI의 앱 데이터베이스에는
            원문 비밀번호를 저장하지 않습니다.
          </li>
        </ul>

        <h3>프로필과 서비스 설정</h3>
        <ul>
          <li>이름, 사역 역할, 교단, 신학 배경, 교회 이름과 연락처</li>
          <li>이메일·브라우저 알림 및 설교 완성 알림 설정</li>
          <li>관리자가 등급별로 선택한 AI 엔진, API 주소, 모델과 추론 강도</li>
          <li>
            관리자가 등록한 AI 공급자 API 키의 암호문(원문 키는 관리자에게도 다시
            표시하지 않습니다)
          </li>
        </ul>

        <h3>설교 작성과 저장</h3>
        <ul>
          <li>
            설교 제목, 성경 본문, 설교 유형, 대상, 청중 상황, 분량, 설교 구성, 감정선과 수정 지시
          </li>
          <li>참고 자료 URL, 메모, 첨부한 텍스트 파일의 이름·형식·크기와 읽어 들인 텍스트</li>
          <li>생성된 설교 대안, 선택한 원고, 수정 버전, 완성 원고와 생성·수정 시각</li>
        </ul>

        <h3>설교 피드백</h3>
        <ul>
          <li>피드백을 신청한 설교, 요청 사유, 배정 상태와 대기 순서</li>
          <li>피드백 참여자의 이름·역할, 메시지, 언급한 원고 구간과 작성 시각</li>
        </ul>

        <h3>스터디와 사역 활용</h3>
        <ul>
          <li>선택한 완성 설교와 원문·배경·구조 연구 항목</li>
          <li>소그룹 나눔 질문지, 주보용 설교 요약문 또는 숏폼 문구 생성 요청과 결과</li>
          <li>생성 과정에서 교단·신학 배경·사역 역할·교회 정보를 해석의 참고 문맥으로 사용할 수 있습니다.</li>
          <li>이메일 주소와 연락처는 설교 생성, 스터디 또는 사역 활용을 위해 AI 제공자에게 전송하지 않습니다.</li>
        </ul>

        <h3>토큰 지갑과 결제</h3>
        <ul>
          <li>토큰 잔액, 지급·충전·사용·환불 수량, 처리 시각과 관련 생성 요청 식별자</li>
          <li>충전 금액, 통화, 선택한 결제수단, 결제 상태와 포트원 결제·거래 식별자</li>
          <li>카드 번호와 CVC 같은 결제수단 원문 정보는 로고스AI가 직접 저장하지 않습니다.</li>
        </ul>
      </>
    ),
  },
  {
    id: "storage",
    title: "저장 위치와 기기 저장소",
    content: (
      <>
        <p>
          로그인 계정의 인증 정보는 <strong>Supabase Auth</strong>가 처리합니다. 프로필,
          설정, 설교와 피드백 기록은 서비스에 연결된 <strong>Supabase PostgreSQL</strong>
          데이터베이스에 저장될 수 있습니다.
        </p>
        <p>브라우저에는 기능 제공을 위해 다음 정보가 저장될 수 있습니다.</p>
        <ul>
          <li>
            <strong>쿠키:</strong> Supabase 로그인 세션, 로그인 유지 방식, 비회원 설교
            미리보기 1회 사용 여부
          </li>
          <li>
            <strong>localStorage:</strong> 작성 중인 설교 초안과 로컬 저장 이력,
            프로필·알림 설정의 기기 사본
          </li>
          <li>
            <strong>sessionStorage:</strong> 일시적인 저장 상태 안내
          </li>
        </ul>
        <p>
          AI 공급자 API 키는 브라우저나 데이터베이스에 저장하지 않고 서버의 비밀 환경
          변수에서만 읽습니다. 일반 이용자는 엔진, 모델, API 주소 또는 키를 변경할 수 없습니다.
        </p>
        <p>
          반면 작성 중인 설교 초안과 로컬 저장 이력은 현재 로그인 계정별로 분리되지 않으며,
          로그아웃해도 localStorage에서 자동으로 삭제되지 않습니다. 공유 기기에서는 다음
          사용자가 이를 볼 수 있으므로 이용 후 브라우저의 사이트 데이터를 직접 삭제해 주세요.
        </p>
      </>
    ),
  },
  {
    id: "third-parties",
    title: "외부 서비스와 정보 전달",
    content: (
      <>
        <p>서비스 기능에 따라 다음 외부 서비스 또는 다른 이용자에게 정보가 전달됩니다.</p>
        <ul>
          <li>
            <strong>Supabase:</strong> 회원 인증과 서비스 데이터베이스 제공
          </li>
          <li>
            <strong>Google:</strong> 이용자가 Google 로그인을 선택한 경우 OAuth 인증 제공
          </li>
          <li>
            <strong>Vercel:</strong> www.sermon-ai.shop 애플리케이션 실행과 요청 전달을
            위한 호스팅 인프라 제공
          </li>
          <li>
            <strong>포트원·NHN KCP:</strong> 이용자가 토큰을 충전할 때 카드 및
            카카오페이·네이버페이 일회성 결제 화면 제공, 결제 승인과 부정 이용 방지 처리
          </li>
          <li>
            <strong>AI 제공자:</strong> 서버 관리형 OpenAI 또는 관리자가 선택한
            OpenAI, Anthropic, Google Gemini, OpenRouter, 공개 HTTP·HTTPS 호환 API에 설교
            조건·본문·참고 자료·수정 지시, 스터디·사역 활용 요청과 필요한 신학·사역 문맥을 전송
          </li>
          <li>
            <strong>피드백 전문가:</strong> 대기 중인 피드백 요청을 검토하는 전문가는 요청자 이름,
            설교 제목, 신청 사유와 상태를 볼 수 있고, 배정된 뒤에만 설교 원문과 피드백
            메시지를 열람할 수 있습니다.
          </li>
        </ul>
        <p>
          특히 사용자가 직접 지정하는 호환 AI API의 운영자와 처리 조건은 로고스AI가
          정하지 않습니다. 연결하기 전에 해당 서비스의 개인정보처리방침과 보안 수준을
          확인해 주세요.
        </p>
      </>
    ),
  },
  {
    id: "retention",
    title: "보관과 삭제",
    content: (
      <>
        <p>
          계정, 프로필, 설정, 토큰·결제 원장, 서버에 저장한 설교와 피드백 기록에는 현재 별도의 자동 삭제
          기한이 설정되어 있지 않습니다. 브라우저 localStorage의 정보도 이용자가 브라우저
          데이터를 지우기 전까지 남을 수 있습니다.
        </p>
        <ul>
          <li>로그인 유지 옵션을 선택하면 로그인 방식 쿠키는 최대 7일간 유지됩니다.</li>
          <li>비회원 미리보기 사용 여부 쿠키는 최대 1년간 유지됩니다.</li>
          <li>AI 공급자 API 키는 브라우저 저장소에 보관하지 않습니다.</li>
        </ul>
        <p>
          현재 앱에는 계정 전체와 관련 기록을 한 번에 삭제하는 자동 화면이 없습니다.
          서버 기록 또는 계정 정리가 필요하면
          {" "}
          <a href="mailto:hello@sermonguide.kr">hello@sermonguide.kr</a>로 문의해 주세요.
        </p>
      </>
    ),
  },
  {
    id: "choices",
    title: "이용자의 선택과 확인 방법",
    content: (
      <>
        <ul>
          <li>계정 설정에서 이름, 사역 역할, 교단·신학 배경, 교회 이름과 연락처를 확인·수정할 수 있습니다.</li>
          <li>알림 설정은 내 정보에서 변경할 수 있고, AI 엔진은 관리자만 변경할 수 있습니다.</li>
          <li>브라우저 설정에서 쿠키와 localStorage 정보를 직접 삭제할 수 있습니다.</li>
          <li>
            공유 기기에서는 로그아웃만으로 로컬 설교 초안과 이력이 지워지지 않으므로,
            브라우저의 www.sermon-ai.shop 사이트 데이터를 함께 삭제해야 합니다.
          </li>
          <li>일반 이용자는 AI 공급자 API 키를 입력하지 않습니다.</li>
        </ul>
        <p>
          저장된 정보에 관한 문의는 아래 연락처로 접수할 수 있습니다. 요청 범위를 확인하기
          위해 계정 이메일 등 본인 확인에 필요한 정보를 요청할 수 있습니다.
        </p>
      </>
    ),
  },
  {
    id: "security",
    title: "보호 조치와 이용 시 주의사항",
    content: (
      <>
        <p>
          로고스AI는 Supabase 세션 검증, 계정별 데이터 접근 확인과 데이터베이스의 행 수준
          보안을 사용합니다. 관리자 이메일은 서버 허용 목록으로 확인하고 AI 공급자 API 키는
          서버 비밀 변수로 분리합니다.
        </p>
        <p>
          관리자가 직접 입력한 AI 주소는 HTTP 또는 HTTPS일 수 있습니다. HTTP 연결에서는 API
          키와 설교 요청 내용이 전송 구간에서 암호화되지 않으므로, 위험을 이해하고 신뢰할 수
          있는 공개 서버에서만 사용해야 합니다. 로컬·사설·예약 네트워크 주소는 차단합니다.
        </p>
        <p>
          다만 어떤 전송이나 저장 방식도 절대적인 안전을 보장할 수는 없습니다. 설교 원고와
          참고 자료에는 주민등록번호, 금융정보, 의료정보 또는 상담 대상자의 민감한 사연처럼
          생성에 필요하지 않은 개인정보를 입력하지 마세요.
        </p>
      </>
    ),
  },
  {
    id: "changes-and-contact",
    title: "방침 변경과 문의",
    content: (
      <>
        <p>
          서비스 기능이나 데이터 흐름이 달라지면 이 페이지의 내용과 시행일을 함께
          업데이트합니다. 개인정보 처리에 관한 문의는
          {" "}
          <a href="mailto:hello@sermonguide.kr">hello@sermonguide.kr</a>로 보내 주세요.
        </p>
        <p>
          <strong>시행일:</strong> 2026년 8월 19일
        </p>
      </>
    ),
  },
];

export default function PrivacyPage() {
  return (
    <LegalDocument
      currentPath="/privacy"
      eyebrow="Privacy policy"
      title="개인정보처리방침"
      summary="로고스AI가 어떤 정보를 왜 처리하는지, 어디에 저장되는지, 이용자가 무엇을 선택할 수 있는지 안내합니다."
      effectiveDate="2026년 8월 19일"
      sections={sections}
    />
  );
}
