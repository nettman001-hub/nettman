import Link from "next/link";
import { AiSessionBoundary } from "@/app/_components/ai-session-boundary";

const features = [
  {
    number: "01",
    title: "한 본문, 다섯 관점",
    description:
      "입력한 성경 본문과 목회 상황을 바탕으로 서로 다른 5개의 설교 방향을 제안합니다.",
  },
  {
    number: "02",
    title: "대화하듯 다듬기",
    description:
      "도입, 본론, 결론, 적용 중 원하는 부분을 짚어 최대 3번까지 정교하게 수정합니다.",
  },
  {
    number: "03",
    title: "바로 쓸 수 있는 원고",
    description:
      "완성한 설교를 안전하게 보관하고 PDF와 Word 문서로 내려받아 바로 준비합니다.",
  },
];

const steps = [
  ["01", "설교의 방향을 정합니다", "주제·대상·분량·감정선과 대지 수를 선택하세요."],
  ["02", "성경 본문을 입력합니다", "본문 중심의 해석과 목회적 적용을 함께 구성합니다."],
  ["03", "다섯 초안 중 하나를 고릅니다", "각 설교의 도입과 핵심 흐름을 비교할 수 있습니다."],
  ["04", "내 목소리에 맞게 다듬습니다", "구체적인 수정 지시를 주고 이전 버전과 비교하세요."],
  ["05", "완성하고 보관합니다", "히스토리에 저장하고 원하는 문서 형식으로 내려받습니다."],
];

export default function LandingPage() {
  return (
    <main className="landing-page">
      <AiSessionBoundary />
      <header className="landing-header container">
        <Link className="brand" href="/" aria-label="설교 가이드 홈">
          <span className="brand-mark" aria-hidden="true">
            <span />
            <span />
          </span>
          <span>설교 가이드</span>
        </Link>
        <nav className="landing-nav" aria-label="주요 메뉴">
          <a href="#how-it-works">사용 방법</a>
          <a href="#features">주요 기능</a>
          <Link href="/login">로그인</Link>
          <Link className="button button-sm button-dark" href="/signup">
            무료로 시작하기
          </Link>
        </nav>
      </header>

      <section className="hero container">
        <div className="hero-copy">
          <div className="eyebrow">
            <span className="eyebrow-dot" />
            본문에서 강단까지, 한 흐름으로
          </div>
          <h1>
            말씀의 본질은 지키고,
            <br />
            <em>준비의 부담은 덜어드립니다.</em>
          </h1>
          <p className="hero-lead">
            설교 가이드는 성경 본문과 목회 상황을 바탕으로 설교 초안 생성,
            원고 수정과 보관을 돕는 AI 설교 작성 서비스입니다. 본문과 현장을
            입력하면 설교의 뼈대부터 적용까지 함께 정리합니다.
          </p>
          <div className="hero-actions">
            <Link className="button button-primary button-lg" href="/sermon/options">
              첫 설교 만들기 <span aria-hidden="true">→</span>
            </Link>
            <Link className="text-link" href="/sermon">
              먼저 둘러보기 <span aria-hidden="true">↗</span>
            </Link>
          </div>
          <div className="hero-proof" aria-label="서비스 특징">
            <span><b>5</b>가지 설교 대안</span>
            <span><b>3</b>회의 세밀한 수정</span>
            <span><b>2</b>가지 문서 형식</span>
          </div>
        </div>

        <div className="hero-visual" aria-label="생성된 설교 미리보기 예시">
          <div className="hero-glow" />
          <article className="sermon-paper">
            <div className="paper-topline">
              <span className="paper-label">SERMON NOTE · 01</span>
              <span className="paper-status">초안 완성</span>
            </div>
            <p className="paper-scripture">요한복음 15:1–8</p>
            <h2>머무름이 열매가 되는 삶</h2>
            <p className="paper-summary">
              분주함 속에서도 주님 안에 머무는 삶이 어떻게 사랑과 인내의
              열매로 이어지는지 살펴봅니다.
            </p>
            <div className="paper-rule" />
            <div className="paper-section">
              <span>도입</span>
              <p>가지가 나무를 떠나 스스로 열매 맺을 수 없듯이…</p>
            </div>
            <div className="paper-section active">
              <span>본론 1</span>
              <div>
                <strong>머무름은 멈춤이 아니라 신뢰입니다</strong>
                <p>예수님의 말씀 안에 거하는 것은 매일의 선택입니다.</p>
              </div>
            </div>
            <div className="paper-section muted">
              <span>적용</span>
              <p>이번 주, 말씀 앞에 머무는 10분을 정해 보세요.</p>
            </div>
            <div className="paper-footer">
              <span>강해 설교</span><span>청장년</span><span>20분</span>
            </div>
          </article>
          <div className="floating-note floating-note-top">
            <span>감정선</span><strong>따뜻한 도전</strong>
          </div>
          <div className="floating-note floating-note-bottom">
            <span className="spark" aria-hidden="true">✦</span>
            <div><strong>AI 구조 점검 완료</strong><small>도입 · 본론 · 결론 · 적용</small></div>
          </div>
        </div>
      </section>

      <section className="scripture-strip" aria-label="서비스 핵심 가치">
        <div className="container scripture-strip-inner">
          <p>“말씀을 더 깊이, 준비는 더 가볍게.”</p>
          <span>설교자의 해석과 목소리를 대신하지 않습니다. 더 선명하게 드러나도록 돕습니다.</span>
        </div>
      </section>

      <section className="section container" id="features">
        <div className="section-heading split-heading">
          <div>
            <span className="section-kicker">WHY SERMON GUIDE</span>
            <h2>설교 준비의 막막한 순간마다<br />다음 한 걸음을 제안합니다.</h2>
          </div>
          <p>
            빈 화면 앞에서 시작하는 시간을 줄이고, 본문과 회중에게 더 오래
            집중할 수 있도록 설계했습니다.
          </p>
        </div>
        <div className="feature-grid">
          {features.map((feature) => (
            <article className="feature-card" key={feature.number}>
              <span className="feature-number">{feature.number}</span>
              <div className="feature-icon" aria-hidden="true"><span /></div>
              <h3>{feature.title}</h3>
              <p>{feature.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="workflow-section" id="how-it-works">
        <div className="container workflow-layout">
          <div className="workflow-intro">
            <span className="section-kicker light">A CLEAR PROCESS</span>
            <h2>생각의 흐름을<br />놓치지 않는 5단계</h2>
            <p>
              이전 단계의 선택은 자동으로 이어지고, 언제든 돌아가 다시
              조정할 수 있습니다.
            </p>
            <Link className="button button-light" href="/sermon/options">
              지금 시작하기 <span aria-hidden="true">→</span>
            </Link>
          </div>
          <ol className="workflow-list">
            {steps.map(([number, title, description]) => (
              <li key={number}>
                <span>{number}</span>
                <div><h3>{title}</h3><p>{description}</p></div>
                <i aria-hidden="true">↗</i>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="section container testimonial-section">
        <div className="testimonial-mark" aria-hidden="true">“</div>
        <blockquote>
          설교의 답을 대신 주는 도구가 아니라, 제가 붙잡은 말씀을 더 깊이
          바라보게 하는 든든한 동역자 같았습니다.
        </blockquote>
        <div className="testimonial-person">
          <span className="avatar">이</span>
          <div><strong>이은혜 전도사</strong><small>주중목회 · 청장년 설교</small></div>
        </div>
      </section>

      <section className="cta-section">
        <div className="container cta-inner">
          <div>
            <span className="section-kicker light">YOUR NEXT SERMON</span>
            <h2>이번 주 설교,<br />본문 한 구절에서 시작하세요.</h2>
          </div>
          <div>
            <p>가입 전에도 한 번의 설교 미리보기를 경험할 수 있습니다.</p>
            <Link className="button button-accent button-lg" href="/sermon/options">
              무료로 설교 만들기 <span aria-hidden="true">→</span>
            </Link>
          </div>
        </div>
      </section>

      <footer className="landing-footer container">
        <Link className="brand" href="/"><span className="brand-mark" aria-hidden="true"><span /><span /></span><span>설교 가이드</span></Link>
        <p>말씀의 본질을 지키는 설교 준비 파트너</p>
        <nav aria-label="하단 메뉴"><a href="#features">서비스 소개</a><Link href="/privacy">개인정보처리방침</Link><Link href="/terms">이용약관</Link><a href="mailto:hello@sermonguide.kr">문의하기</a></nav>
        <small>© 2026 Sermon Guide. All rights reserved.</small>
      </footer>
    </main>
  );
}
