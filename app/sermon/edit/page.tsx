import type { Metadata } from "next";
import { SermonEditor } from "@/app/_components/sermon-editor";

export const metadata: Metadata = {
  title: "설교 수정 | 로고스AI",
  description: "선택한 설교를 최대 세 번 목회적 방향에 맞게 수정합니다.",
};

export default function SermonEditPage() {
  return <SermonEditor />;
}
