export default function AdminMembersLoading() {
  return (
    <div
      className="min-h-screen bg-[#f4f1ea] px-4 py-8 sm:px-8 lg:px-12 lg:py-10"
      aria-label="회원 관리 화면을 불러오는 중"
      aria-busy="true"
    >
      <div className="mx-auto max-w-7xl animate-pulse">
        <div className="h-3 w-28 rounded-full bg-[#d9d3c7]" />
        <div className="mt-4 h-11 w-56 rounded-2xl bg-[#d4cec2]" />
        <div className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((item) => (
            <div key={item} className="h-32 rounded-[1.35rem] border border-[#ddd7cd] bg-white/80" />
          ))}
        </div>
        <div className="mt-6 h-28 rounded-[1.5rem] border border-[#ddd7cd] bg-white/80" />
        <div className="mt-6 h-96 rounded-3xl border border-[#ddd7cd] bg-white/80" />
      </div>
      <span className="sr-only">잠시만 기다려 주세요.</span>
    </div>
  );
}
