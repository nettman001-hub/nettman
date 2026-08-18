"use client";

import Link from "next/link";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="error-page">
      <div className="error-code" aria-hidden="true">500</div>
      <div className="error-content">
        <span className="section-kicker light">SOMETHING WENT WRONG</span>
        <h1>잠시 연결이 고르지 않습니다.</h1>
        <p>작성 중인 내용은 안전하게 보관됩니다. 잠시 후 다시 시도해 주세요.</p>
        <div className="hero-actions" style={{ justifyContent: "center" }}>
          <button className="button button-accent" onClick={reset}>다시 시도</button>
          <Link className="button button-light" href="/home">홈으로 이동</Link>
        </div>
      </div>
    </main>
  );
}
