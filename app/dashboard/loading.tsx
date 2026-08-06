import { Loader2 } from "lucide-react";

/**
 * ダッシュボード配下の共通ローディング。
 * これまで loading.tsx が無く、データ取得中は前の画面のまま固まって見えていた。
 */
export default function DashboardLoading() {
  return (
    <div
      className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-muted-foreground"
      role="status"
      aria-live="polite"
    >
      <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
      <p className="text-sm">読み込んでいます...</p>
    </div>
  );
}
