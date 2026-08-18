export function AppRouteSkeleton({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className="min-h-screen bg-[#f4f1ea] px-4 py-8 sm:px-8 lg:px-12 lg:py-10"
      aria-label="화면을 불러오는 중"
      aria-busy="true"
    >
      <div className="mx-auto max-w-6xl animate-pulse">
        <div className="h-3 w-24 rounded-full bg-[#d9d3c7]" />
        <div className="mt-5 h-10 w-64 max-w-[75vw] rounded-xl bg-[#d0cabf]" />
        <div className="mt-4 h-4 w-[28rem] max-w-full rounded-full bg-[#dfd9ce]" />
        <div
          className={`mt-10 grid gap-5 ${
            compact ? "max-w-3xl" : "sm:grid-cols-2 xl:grid-cols-3"
          }`}
        >
          {[0, 1, 2].map((item) => (
            <div
              key={item}
              className="h-44 rounded-[1.5rem] border border-[#ddd7cc] bg-white/80"
            />
          ))}
        </div>
      </div>
      <span className="sr-only">잠시만 기다려 주세요.</span>
    </div>
  );
}
