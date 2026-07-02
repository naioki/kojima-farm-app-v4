import type { ReactNode } from "react";
import { Separator } from "@/components/ui/separator";
import { Toaster } from "sonner";
import { EmailFetchButton } from "./_components/email-fetch-button";
import { MainNav } from "./_components/main-nav";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="flex h-14 items-center gap-2 px-3 md:px-6 md:gap-4">
          <span className="font-semibold text-sm shrink-0 tracking-tight">
            <span className="hidden sm:inline">🌿 小島農園 管理システム</span>
            <span className="sm:hidden">🌿 小島農園</span>
          </span>
          <Separator orientation="vertical" className="h-5 hidden md:block" />
          <MainNav />
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
