import { getInvoices, getCustomers } from "@/app/actions/invoice-actions";
import { InvoicesClient } from "./_components/invoices-client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle } from "lucide-react";

export default async function InvoicesPage() {
  const [result, customers] = await Promise.all([
    getInvoices(),
    getCustomers(),
  ]);

  if (!result.success) {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{result.error}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return <InvoicesClient invoices={result.data} customers={customers} />;
}
