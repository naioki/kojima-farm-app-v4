import type { Metadata } from "next";
import { Geist, Geist_Mono, Noto_Sans_JP } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";

// Geist は latin サブセットのみで日本語グリフを持たない。これだけを font-sans に
// 割り当てていたため、日本語は OS のフォールバック（Windows: Yu Gothic /
// Mac: Hiragino）で描画され、英数字と日本語で書体が混ざり OS ごとに
// 見た目が変わっていた。日本語フォントを明示的に読み込んで揃える。
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

// 業務画面は数値の一覧が多いので、字面が安定する 400/500/700 に絞る。
// 全ウェイトを読むと日本語フォントは容量が大きく初期表示が遅くなる。
const notoSansJP = Noto_Sans_JP({
  variable: "--font-noto-sans-jp",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  display: "swap",
  preload: false,
});

export const metadata: Metadata = {
  title: "小島農園 管理システム v4",
  description: "農業生産・受注・マスターデータ管理ダッシュボード",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ja"
      className={`${geistSans.variable} ${geistMono.variable} ${notoSansJP.variable}`}
    >
      <body className="min-h-screen bg-background antialiased">
        {children}
        {/* アプリ全体で Toaster はここの1つだけ。複数マウントすると
            sonner が全てに配信してトーストが重複表示される。 */}
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}
