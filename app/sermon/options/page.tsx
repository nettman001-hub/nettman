import type { Metadata } from "next";
import { SermonOptions } from "@/app/_components/sermon-options";

export const metadata: Metadata = {
  title: "옵션 설정 | 설교가이드",
  description: "설교 주제, 분량, 엔진 등급, 유형, 대상과 대지 수를 정합니다.",
};

export default function SermonOptionsPage() {
  return <SermonOptions />;
}
