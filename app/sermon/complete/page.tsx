import type { Metadata } from "next";
import { SermonComplete } from "@/app/_components/sermon-complete";

export const metadata: Metadata = {
  title: "설교 완성 | 로고스AI",
  description: "완성한 설교 원고를 확인하고 PDF 또는 Word로 저장합니다.",
};

export default function SermonCompletePage() {
  return <SermonComplete />;
}
