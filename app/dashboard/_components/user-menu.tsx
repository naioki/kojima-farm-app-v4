"use client";

import { useState } from "react";
import { LogOut, Loader2, UserRound } from "lucide-react";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/**
 * ログイン中のユーザー表示とログアウト。
 *
 * これまでコードベース全体にログアウトの手段が無く、ヘッダーにユーザー名の
 * 表示すらなかった。共有端末（事務所のPC等）で使う業務システムとしては
 * 「誰でログインしているか分からず、切り替えもできない」状態だった。
 */
export function UserMenu({ email }: { email: string | null }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  async function handleLogout() {
    setIsLoggingOut(true);
    try {
      const { error } = await createClient().auth.signOut();
      if (error) {
        toast.error("ログアウトに失敗しました", { description: error.message });
        setIsLoggingOut(false);
        return;
      }
      // クッキーを確実に反映させるためフルリロードで遷移する
      window.location.href = "/login";
    } catch (err) {
      toast.error("ログアウトに失敗しました", {
        description: err instanceof Error ? err.message : String(err),
      });
      setIsLoggingOut(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirmOpen(true)}
        className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        title={email ? `${email} — クリックしてログアウト` : "ログアウト"}
      >
        <UserRound className="h-3.5 w-3.5 shrink-0" />
        {/* 狭い画面ではアドレスを隠す。アイコンは常に出してログアウト経路を確保する */}
        <span className="hidden lg:inline max-w-[180px] truncate">
          {email ?? "ログイン中"}
        </span>
        <LogOut className="h-3.5 w-3.5 shrink-0" />
        <span className="sr-only">ログアウト</span>
      </button>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>ログアウトしますか？</AlertDialogTitle>
            <AlertDialogDescription>
              {email ? `${email} からログアウトします。` : "ログアウトします。"}
              未保存の入力内容は失われます。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isLoggingOut}>キャンセル</AlertDialogCancel>
            <AlertDialogAction
              disabled={isLoggingOut}
              onClick={(e) => {
                e.preventDefault();
                void handleLogout();
              }}
            >
              {isLoggingOut
                ? <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" />処理中...</>
                : "ログアウト"
              }
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
