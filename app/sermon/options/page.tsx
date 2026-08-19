import type { Metadata } from "next";
import { SermonOptions } from "@/app/_components/sermon-options";

export const metadata: Metadata = {
  title: "옵션 설정",
  description:
    "설교 제목, 분량, 유형, 구성, 대상, 청중 상황과 감정선을 정합니다.",
};

export default function SermonOptionsPage() {
  return <SermonOptions />;
}
