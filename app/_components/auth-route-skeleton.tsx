export function AuthRouteSkeleton() {
  return (
    <main
      className="grid min-h-screen place-items-center bg-[#f3efe7] px-5"
      aria-label="인증 화면을 불러오는 중"
      aria-busy="true"
    >
      <div className="w-full max-w-[30rem] animate-pulse">
        <div className="h-3 w-20 rounded-full bg-[#d9d2c6]" />
        <div className="mt-5 h-12 w-72 max-w-[80vw] rounded-xl bg-[#cfc8bc]" />
        <div className="mt-4 h-4 w-full rounded-full bg-[#ddd6cb]" />
        <div className="mt-8 h-48 rounded-[1.75rem] border border-[#ddd6cb] bg-white" />
      </div>
      <span className="sr-only">잠시만 기다려 주세요.</span>
    </main>
  );
}
