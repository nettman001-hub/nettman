import Link from "next/link";
import { AiSessionBoundary } from "@/app/_components/ai-session-boundary";

const features = [
  {
    number: "01",
    title: "목회자가 이끄는 여덟 단계",
    description:
      "상황과 본문에서 시작해 연구·메시지·구조·적용·직접쓰기·점검을 목회자의 기록으로 이어갑니다.",
  },
  {
    number: "02",
    title: "필요할 때만 받는 AI 제안",
    description:
      "AI는 질문과 연구 방향, 점검과 짧은 표현 대안만 제안하며 목회자가 채택해야 기록에 반영됩니다.",
  },
  {
    number: "03",
    title: "두 가지 준비 방식",
    description:
      "직접 준비하는 설교도우미와 다섯 초안을 비교하는 AI 설교 생성을 목적에 맞게 선택할 수 있습니다.",
  },
];

const steps = [
  ["01", "마음을 열고 본문을 읽습니다", "설교 상황을 정리하고 본문에서 직접 관찰한 내용을 기록합니다."],
  ["02", "깊이 살피고 메시지를 붙잡습니다", "문맥과 자료를 검증하고 이번 설교의 한 문장 메시지를 씁니다."],
  ["03", "흐름을 세우고 삶에 잇습니다", "구조를 설계하고 실제 회중에게 닿는 적용을 준비합니다."],
  ["04", "내 언어로 쓰고 책임 있게 점검합니다", "원고를 직접 쓴 뒤 본문·출처·신학·개인정보를 확인합니다."],
];

export default function LandingPage() {
  return (
    <main className="landing-page">
      <AiSessionBoundary />
      <header className="landing-header container">
        <Link className="brand" href="/" aria-label="로고스AI 홈">
          <span className="brand-mark" aria-hidden="true">로</span>
          <span>로고스AI</span>
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
            설교도우미는 원고를 대신 쓰지 않습니다. 목회자가 본문을 묵상하고
            회중을 생각하며 자기 설교를 완성하도록, 여덟 단계마다 질문과 자료,
            점검을 제공합니다. 필요할 때만 AI의 제안을 받아 직접 선택하세요.
          </p>
          <div className="hero-actions">
            <Link className="button button-primary button-lg" href="/sermon-helper">
              설교도우미로 준비하기 <span aria-hidden="true">→</span>
            </Link>
            <Link className="text-link" href="/sermon/options">
              AI로 초안 만들기 <span aria-hidden="true">↗</span>
            </Link>
          </div>
          <div className="hero-proof" aria-label="서비스 특징">
            <span><b>8</b>단계 직접 준비</span>
            <span><b>4</b>묵상 흐름</span>
            <span><b>1</b>명확한 최종 책임</span>
          </div>
        </div>

        <div className="hero-visual" aria-label="설교도우미 직접 작성 화면 예시">
          <div className="hero-glow" />
          <article className="sermon-paper">
            <div className="paper-topline">
              <span className="paper-label">SERMON HELPER · 07</span>
              <span className="paper-status">직접 작성 중</span>
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
            <div><strong>AI 질문 제안</strong><small>채택 전에는 원고에 반영되지 않습니다</small></div>
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
            <span className="section-kicker">WHY LOGOS AI</span>
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
            <h2>생각의 흐름을<br />이어가는 4가지 움직임</h2>
            <p>
              여덟 세부 단계를 자유롭게 오가며 목회자의 생각을 기록하고,
              언제든 돌아가 다시 조정할 수 있습니다.
            </p>
            <Link className="button button-light" href="/sermon-helper">
              설교도우미 시작하기 <span aria-hidden="true">→</span>
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
              AI 설교 미리보기 <span aria-hidden="true">→</span>
            </Link>
          </div>
        </div>
      </section>

      <footer className="landing-footer container">
        <Link className="brand" href="/"><span className="brand-mark" aria-hidden="true">로</span><span>로고스AI</span></Link>
        <p>말씀의 본질을 지키는 설교 준비 파트너</p>
        <nav aria-label="하단 메뉴"><a href="#features">서비스 소개</a><Link href="/privacy">개인정보처리방침</Link><Link href="/terms">이용약관</Link><a href="mailto:hello@sermonguide.kr">문의하기</a></nav>
        <small>© 2026 LOGOS AI. All rights reserved.</small>
      </footer>
    </main>
  );
}
