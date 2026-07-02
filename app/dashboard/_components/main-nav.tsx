"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ScanLine,
  ClipboardList,
  ReceiptText,
  BarChart3,
  Database,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/dashboard/verifications", label: "OCR 検証", icon: ScanLine },
  { href: "/dashboard/orders", label: "受注一覧", icon: ClipboardList },
  { href: "/dashboard/invoices", label: "請求書", icon: ReceiptText },
  { href: "/dashboard/analytics", label: "売上", icon: BarChart3 },
  { href: "/dashboard/master", label: "マスター", icon: Database },
  { href: "/dashboard/settings", label: "設定", icon: Settings },
];

export function MainNav() {
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-1 flex-1 overflow-x-auto whitespace-nowrap scrollbar-none">
      {navItems.map((item) => {
        const active = pathname.startsWith(item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm transition-colors shrink-0",
              active
                ? "bg-primary/10 text-primary font-medium"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            )}
          >
            <Icon className="w-4 h-4" />
            <span className="hidden md:inline">{item.label}</span>
            <span className="md:hidden">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
