import type { ReactNode } from "react";

type AppPageHeadingProps = {
  eyebrow?: string;
  title: string;
  description: string;
  action?: ReactNode;
};

export function AppPageHeading({
  eyebrow,
  title,
  description,
  action,
}: AppPageHeadingProps) {
  return (
    <div className="flex flex-col gap-5 border-b border-[#d8d2c7] pb-7 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-2xl">
        {eyebrow ? (
          <p className="mb-2 text-[11px] font-extrabold tracking-[0.18em] text-[#a56732] uppercase">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="font-serif text-[clamp(2rem,4vw,3rem)] font-bold leading-[1.06] tracking-[-0.035em] text-[#203a30]">
          {title}
        </h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-[#65716c] sm:text-base">
          {description}
        </p>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
