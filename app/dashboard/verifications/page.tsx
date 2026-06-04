import { getAllVerifications, fetchMasterData } from "@/app/actions/ocr-actions";
import { VerificationDashboard } from "./_components/verification-dashboard";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle } from "lucide-react";

export default async function VerificationsPage() {
  const [result, masterResult] = await Promise.all([
    getAllVerifications(),
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

  const masterData = masterResult.success ? masterResult.data : { stores: [], products: [], specs: [] };

  return <VerificationDashboard initialVerifications={result.data} masterData={masterData} />;
}
