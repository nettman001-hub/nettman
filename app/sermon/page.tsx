import type { Metadata } from "next";
import { SermonStart } from "@/app/_components/sermon-start";

export const metadata: Metadata = {
  title: "설교 생성 | 설교가이드",
  description: "본문과 옵션을 바탕으로 다섯 가지 설교 초안을 준비합니다.",
};

export default function SermonPage() {
  return <SermonStart />;
}
