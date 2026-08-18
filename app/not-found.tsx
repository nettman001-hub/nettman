import Link from "next/link";

export default function NotFound() {
  return (
    <main className="error-page">
      <div className="error-code" aria-hidden="true">404</div>
      <div className="error-content">
        <span className="section-kicker light">PAGE NOT FOUND</span>
        <h1>길을 잠시 잃으셨나요?</h1>
        <p>요청하신 페이지를 찾을 수 없습니다. 홈으로 돌아가거나 새로운 설교 준비를 시작해 보세요.</p>
        <Link className="button button-accent" href="/home">홈으로 돌아가기</Link>
      </div>
    </main>
  );
}
