import { getVerifications, fetchMasterData } from "@/app/actions/ocr-actions";
import { VerificationDashboard } from "./_components/verification-dashboard";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle } from "lucide-react";
import { isDateRange, type DateRange } from "@/lib/verification";

/**
 * 期間は URL のクエリで受ける。
 *
 * 以前は全件を parsed_lines ごと取得してからクライアントで期間フィルタを
 * 掛けていたため、データが増えるほど毎回の転送量が膨らんでいた。
 * URL に載せることでサーバー側で絞り込めるうえ、期間を指定した状態を
 * ブックマークしたり共有したりできる。
 */
export default async function VerificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const { range } = await searchParams;
  const dateRange: DateRange = isDateRange(range) ? range : "30d";

  const [result, masterResult] = await Promise.all([
    getVerifications(dateRange),
    fetchMasterData(),
  ]);

  if (!result.success) {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>データの取得に失敗しました</AlertTitle>
          <AlertDescription>{result.error}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const masterData = masterResult.success
    ? masterResult.data
    : { stores: [], storeOrder: {}, products: [], specs: [] };

  return (
    <VerificationDashboard
      initialVerifications={result.data.items}
      truncated={result.data.truncated}
      dateRange={dateRange}
      masterData={masterData}
    />
  );
}
