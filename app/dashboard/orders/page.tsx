import { getOrders } from "@/app/actions/order-actions";
import { OrdersClient } from "./_components/orders-client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle } from "lucide-react";

export default async function OrdersPage() {
  const result = await getOrders();

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

  return <OrdersClient initialOrders={result.data} />;
}
