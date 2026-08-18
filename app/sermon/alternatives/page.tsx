import type { Metadata } from "next";
import { SermonAlternatives } from "@/app/_components/sermon-alternatives";

export const metadata: Metadata = {
  title: "대안 선택 | 설교가이드",
  description: "서로 다른 다섯 설교 초안을 비교하고 한 편을 선택합니다.",
};

export default function SermonAlternativesPage() {
  return <SermonAlternatives />;
}
