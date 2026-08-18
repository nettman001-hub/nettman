"use client";

import { AppRouteError } from "@/app/_components/app-route-error";

export default function Error({ reset }: { reset: () => void }) {
  return <AppRouteError reset={reset} title="홈을 불러오지 못했습니다" />;
}
