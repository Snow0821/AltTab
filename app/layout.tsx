import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PassFinder 합격 길잡이",
  description: "교안 PDF로 내 AI가 만든 검수 문항을 쉬운 개념부터 한 스테이지씩 풀어 나가는 시험 대비 서비스",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="min-h-screen">
        <header className="border-b border-[var(--line)] bg-white">
          <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
            <a href="/" className="text-lg font-bold">
              PassFinder <span className="text-sm font-normal text-[var(--muted)]">합격 길잡이</span>
            </a>
          </div>
        </header>
        <main className="mx-auto max-w-3xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
