import Link from "next/link";

export default function ServerErrorPage() {
  return (
    <main className="error-page">
      <div className="error-code" aria-hidden="true">500</div>
      <div className="error-content">
        <span className="section-kicker light">SERVER ERROR</span>
        <h1>잠시 쉬어가도 괜찮습니다.</h1>
        <p>서버에서 요청을 처리하지 못했습니다. 잠시 후 다시 시도하거나 홈으로 이동해 주세요.</p>
        <Link className="button button-accent" href="/home">홈으로 이동</Link>
      </div>
    </main>
  );
}
