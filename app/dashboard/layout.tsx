import type { ReactNode } from "react";
import Link from "next/link";
import { Separator } from "@/components/ui/separator";
import { Toaster } from "sonner";
import { EmailFetchButton } from "./_components/email-fetch-button";

const navItems = [
  { href: "/dashboard/verifications", label: "OCR 検証" },
  { href: "/dashboard/orders", label: "受注一覧" },
  { href: "/dashboard/master", label: "マスターデータ" },
  { href: "/dashboard/settings", label: "⚙ 設定" },
];

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-50 border-b bg-background">
        <div className="flex h-14 items-center px-6 gap-6">
          <span className="font-semibold text-sm">🌿 小島農園 管理システム</span>
          <Separator orientation="vertical" className="h-5" />
          <nav className="flex items-center gap-4 flex-1">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          {/* メール取得ボタン */}
          <EmailFetchButton />
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <Toaster richColors position="top-right" />
    </div>
  );
}
