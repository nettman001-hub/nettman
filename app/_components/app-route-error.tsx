"use client";

type AppRouteErrorProps = {
  reset: () => void;
  title?: string;
};

export function AppRouteError({
  reset,
  title = "화면을 불러오지 못했습니다",
}: AppRouteErrorProps) {
  return (
    <main className="grid min-h-screen place-items-center bg-[#f4f1ea] px-5 py-12 text-[#21372e]">
      <section className="w-full max-w-lg rounded-[2rem] border border-[#d8d1c5] bg-white p-7 text-center shadow-[0_22px_70px_rgba(35,47,40,.1)] sm:p-10">
        <span
          aria-hidden="true"
          className="mx-auto grid size-14 place-items-center rounded-2xl bg-[#f7e7d4] font-serif text-2xl font-bold text-[#965b2c]"
        >
          !
        </span>
        <h1 className="mt-5 font-serif text-2xl font-bold tracking-tight">
          {title}
        </h1>
        <p className="mt-3 text-sm leading-6 text-[#68736d]">
          일시적인 연결 문제일 수 있습니다. 입력한 내용은 그대로 두고 다시
          시도해 주세요.
        </p>
        <div className="mt-7 flex flex-col gap-2.5 sm:flex-row sm:justify-center">
          <button
            type="button"
            onClick={reset}
            className="min-h-11 rounded-xl bg-[#285343] px-5 text-sm font-bold text-white hover:bg-[#1f4537] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b97838] focus-visible:ring-offset-2"
          >
            다시 시도
          </button>
          <a
            href="/home"
            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-[#d2ccc1] px-5 text-sm font-bold hover:bg-[#f7f4ee] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b97838] focus-visible:ring-offset-2"
          >
            홈으로 이동
          </a>
        </div>
      </section>
    </main>
  );
}
