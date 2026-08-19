"use client";

import { AppRouteError } from "../../_components/app-route-error";

export default function Error({ reset }: { reset: () => void }) {
  return <AppRouteError reset={reset} title="피드백 검토 화면을 불러오지 못했습니다" />;
}
