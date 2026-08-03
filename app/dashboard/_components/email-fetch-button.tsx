"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Mail, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { fetchEmailsNow } from "@/app/actions/config-actions";

export function EmailFetchButton() {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleFetch() {
    setLoading(true);
    try {
      // Server Action 経由。ブラウザから FastAPI を直接叩くとアクセストークンを
      // 載せられず、認可を通せない。
      const result = await fetchEmailsNow();
      if (!result.success) {
        toast.error("メール取得に失敗しました", { description: result.error });
        return;
      }
      if (result.data.fetched === 0) {
        toast.info("新しいメールはありませんでした");
      } else {
        toast.success(`${result.data.fetched} 件取得しました`, {
          description: "検証リストを更新しています...",
        });
        router.refresh();
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleFetch}
      disabled={loading}
      className="gap-1.5"
    >
      {loading ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Mail className="h-3.5 w-3.5" />
      )}
      {loading ? "取得中..." : "メール取得"}
    </Button>
  );
}
