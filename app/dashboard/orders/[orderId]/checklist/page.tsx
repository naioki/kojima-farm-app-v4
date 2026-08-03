import Link from "next/link";
import { AlertTriangle, ArrowLeft } from "lucide-react";

import { getOrderChecklist } from "@/app/actions/checklist-actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ChecklistClient } from "./_components/checklist-client";

export default async function ChecklistPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  const result = await getOrderChecklist(orderId);

  if (!result.success) {
    return (
      <div className="p-4 space-y-4">
        <Button asChild variant="ghost" size="sm" className="gap-1.5">
          <Link href="/dashboard/orders">
            <ArrowLeft className="h-4 w-4" />
            受注一覧へ戻る
          </Link>
        </Button>
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>チェックリストを表示できません</AlertTitle>
          <AlertDescription>{result.error}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return <ChecklistClient initial={result.data} />;
}
