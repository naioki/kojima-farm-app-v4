import { getPendingVerifications } from "@/app/actions/ocr-actions";
import { VerificationDashboard } from "./_components/verification-dashboard";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle } from "lucide-react";

export const runtime = "edge";

export default async function VerificationsPage() {
  const result = await getPendingVerifications();

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

  return <VerificationDashboard initialVerifications={result.data} />;
}
