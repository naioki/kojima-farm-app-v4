import type { ReactNode } from "react";
import Link from "next/link";
import { Separator } from "@/components/ui/separator";
import { Toaster } from "sonner";
import { EmailFetchButton } from "./_components/email-fetch-button";

const navItems = [
  { href: "/dashboard/verifications", label: "OCR 検証" },
  { href: "/dashboard/orders", label: "受注一覧" },
  { href: "/dashboard/invoices", label: "請求書" },
  { href: "/dashboard/analytics", label: "売上" },
  { href: "/dashboard/master", label: "マスター" },
  { href: "/dashboard/settings", label: "⚙ 設定" },
];

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-50 border-b bg-background">
        <div className="flex h-14 items-center gap-2 px-3 md:px-6 md:gap-6">
          <span className="font-semibold text-sm shrink-0">
            <span className="hidden sm:inline">🌿 小島農園 管理システム</span>
            <span className="sm:hidden">🌿 小島農園</span>
          </span>
          <Separator orientation="vertical" className="h-5 hidden md:block" />
          <nav className="flex items-center gap-3 md:gap-4 flex-1 overflow-x-auto whitespace-nowrap scrollbar-none">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-sm text-muted-foreground hover:text-foreground transition-colors shrink-0"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          {/* メール取得ボタン */}
          <div className="shrink-0">
            <EmailFetchButton />
          </div>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <Toaster richColors position="top-right" />
    </div>
  );
}
