import type { ReactNode } from "react";
import { Separator } from "@/components/ui/separator";
import { createClient } from "@/lib/supabase/server";
import { EmailFetchButton } from "./_components/email-fetch-button";
import { MainNav } from "./_components/main-nav";
import { UserMenu } from "./_components/user-menu";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();

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
          <div className="flex shrink-0 items-center gap-1">
            <EmailFetchButton />
            <UserMenu email={data.user?.email ?? null} />
          </div>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      {/* Toaster は app/layout.tsx に1つだけ置く。
          ここにも置くと sonner が両方の Toaster に配信するため、
          ダッシュボード配下で全てのトーストが2枚重なって表示されていた。 */}
    </div>
  );
}
