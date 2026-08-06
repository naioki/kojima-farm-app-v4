import { getOrders } from "@/app/actions/order-actions";
import { OrdersClient } from "./_components/orders-client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle } from "lucide-react";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const VALID_STATUSES = ["draft", "confirmed", "cancelled"];

/** URL の値をそのまま DB クエリに渡さない（形式を検証してから使う）。 */
function sanitizeDate(value: string | undefined): string | undefined {
  return value && DATE_PATTERN.test(value) ? value : undefined;
}

function sanitizeStatus(value: string | undefined): string | undefined {
  return value && VALID_STATUSES.includes(value) ? value : undefined;
}

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; status?: string }>;
}) {
  const params = await searchParams;
  const filters = {
    from: sanitizeDate(params.from),
    to: sanitizeDate(params.to),
    status: sanitizeStatus(params.status),
  };

  const result = await getOrders(filters);

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

  return (
    <OrdersClient
      initialOrders={result.data.items}
      truncated={result.data.truncated}
      filters={filters}
    />
  );
}
