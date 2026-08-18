import type { ReactNode } from "react";

type AppNoticeProps = {
  tone?: "info" | "success" | "warning" | "error";
  title: string;
  children: ReactNode;
};

const TONE_STYLES = {
  info: "border-[#b9d3c8] bg-[#edf6f1] text-[#284b3e]",
  success: "border-[#b7d3bd] bg-[#eef7ef] text-[#295437]",
  warning: "border-[#e4c99f] bg-[#fff8e9] text-[#68491e]",
  error: "border-[#e2b8ae] bg-[#fff1ee] text-[#7b352b]",
};

export function AppNotice({ tone = "info", title, children }: AppNoticeProps) {
  return (
    <div
      className={`rounded-2xl border px-4 py-3.5 ${TONE_STYLES[tone]}`}
      role={tone === "error" ? "alert" : "status"}
    >
      <p className="text-sm font-extrabold">{title}</p>
      <div className="mt-1 text-xs leading-5 opacity-80">{children}</div>
    </div>
  );
}
