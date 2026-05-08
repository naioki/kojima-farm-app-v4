"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Mail, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { fetchEmails } from "@/lib/api-client";

export function EmailFetchButton() {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleFetch() {
    setLoading(true);
    try {
      const result = await fetchEmails();
      if (result.fetched === 0) {
        toast.info("新しいメールはありませんでした");
      } else {
        toast.success(`${result.fetched} 件取得しました`, {
          description: "検証リストを更新しています...",
        });
        router.refresh();
      }
    } catch (err) {
      toast.error("メール取得に失敗しました", { description: String(err) });
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
