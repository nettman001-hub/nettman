import type { Metadata } from "next";
import { SermonPreview } from "@/app/_components/sermon-preview";

export const metadata: Metadata = {
  title: "설교 미리보기 | 로고스AI",
  description: "선택한 설교 초안의 도입, 본론, 결론과 적용을 확인합니다.",
};

export default function SermonPreviewPage() {
  return <SermonPreview />;
}
