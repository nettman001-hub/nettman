import type { Metadata } from "next";
import { AppPageHeading } from "@/app/_components/app-page-heading";
import { AppShell } from "@/app/_components/app-shell";
import { requirePageUser } from "@/app/_lib/auth-user";
import { TokenWalletPanel } from "./token-wallet-panel";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "토큰 충전 | 설교가이드",
  description: "설교 생성 토큰 잔액과 사용 내역을 확인하고 필요한 만큼 일회성으로 충전합니다.",
};

export default async function TokensPage() {
  const user = await requirePageUser("/tokens");
  return (
    <AppShell
      active="tokens"
      user={{ id: user.id, displayName: user.name, email: user.email, isAdmin: user.isAdmin }}
    >
      <div className="mx-auto max-w-6xl px-4 py-7 sm:px-7 sm:py-10 lg:px-10">
        <AppPageHeading
          eyebrow="Token wallet"
          title="토큰 충전"
          description="구독 없이 필요한 만큼 충전하고, 설교 초안마다 사용한 토큰을 투명하게 확인하세요."
        />
        <TokenWalletPanel email={user.email} />
      </div>
    </AppShell>
  );
}
