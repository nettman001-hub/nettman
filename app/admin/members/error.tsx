"use client";

import { AppRouteError } from "@/app/_components/app-route-error";

export default function AdminMembersError({ reset }: { reset: () => void }) {
  return (
    <AppRouteError
      title="회원 관리 화면을 열지 못했습니다."
      reset={reset}
    />
  );
}
