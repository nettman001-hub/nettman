import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const base = new URL(`${protocol}://${host}`);
  const socialImage = new URL("/og.png", base).href;
  return {
    metadataBase: base,
    title: {
      default: "로고스AI — 말씀의 본질은 지키고, 준비의 부담은 덜고",
      template: "%s | 로고스AI",
    },
    description:
      "성경 본문과 목회 상황을 바탕으로 5가지 설교 초안을 만들고, 대화하듯 다듬어 완성하는 설교 준비 도구입니다.",
    icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
    openGraph: {
      title: "로고스AI",
      description: "본문에서 강단까지, 생각의 흐름을 놓치지 않는 설교 준비",
      type: "website",
      locale: "ko_KR",
      url: base,
      images: [{ url: socialImage, width: 1732, height: 908, alt: "로고스AI — 말씀의 본질은 지키고, 준비의 부담은 덜어드립니다." }],
    },
    twitter: {
      card: "summary_large_image",
      title: "로고스AI",
      description: "말씀의 본질은 지키고, 준비의 부담은 덜어드립니다.",
      images: [socialImage],
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        {children}
      </body>
    </html>
  );
}
