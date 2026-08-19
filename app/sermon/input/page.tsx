import type { Metadata } from "next";
import { SermonInput } from "@/app/_components/sermon-input";

export const metadata: Metadata = {
  title: "본문 입력 | 로고스AI",
  description: "성경 본문과 참고 자료를 입력해 다섯 가지 설교 초안을 생성합니다.",
};

export default function SermonInputPage() {
  return <SermonInput />;
}
