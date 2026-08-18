"use client";

import { AppRouteError } from "@/app/_components/app-route-error";

export default function Error({ reset }: { reset: () => void }) {
  return <AppRouteError reset={reset} title="계정 보안 화면을 열지 못했습니다" />;
}
