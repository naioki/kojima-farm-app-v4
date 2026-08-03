"use client";

/**
 * ダッシュボード配下の共通エラー境界。
 *
 * これまで loading.tsx / error.tsx がどのルートにも無く、たとえば
 * analytics/page.tsx は getAnalytics() の失敗を捕まえていなかったため、
 * DB エラーでそのまま白画面になっていた。
 */

import { useEffect } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[dashboard] レンダリング中のエラー:", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <Card className="w-full max-w-lg">
        <CardHeader className="space-y-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10">
            <AlertTriangle className="h-5 w-5 text-destructive" aria-hidden />
          </div>
          <CardTitle className="text-lg">画面の表示中にエラーが発生しました</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            一時的な通信エラーの可能性があります。「再読み込み」で復帰しない場合は、
            下のエラー内容を添えて連絡してください。
          </p>
          <pre className="max-h-32 overflow-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap break-all">
            {error.message || "詳細不明のエラー"}
            {error.digest ? `\n(digest: ${error.digest})` : ""}
          </pre>
          <div className="flex gap-2">
            <Button onClick={reset} className="gap-1.5">
              <RotateCcw className="h-4 w-4" />
              再読み込み
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                navigator.clipboard.writeText(
                  `${error.message}${error.digest ? ` (digest: ${error.digest})` : ""}`
                )
              }
            >
              エラー内容をコピー
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
