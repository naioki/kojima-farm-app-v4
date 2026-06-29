"use client";

import { useState, useTransition } from "react";
import { FileDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { getInvoiceDetail, getCompanySettings } from "@/app/actions/invoice-actions";

interface Props {
  invoiceId: string;
  invoiceNumber: string;
  customerName: string;
}

export function InvoicePDFButton({ invoiceId, invoiceNumber, customerName }: Props) {
  const [isPending, startTransition] = useTransition();
  const [generated, setGenerated] = useState(false);

  function handleDownload() {
    startTransition(async () => {
      try {
        const [detailRes, company] = await Promise.all([
          getInvoiceDetail(invoiceId),
          getCompanySettings(),
        ]);
        if (!detailRes.success) { toast.error(detailRes.error); return; }

        const { invoice, items } = detailRes.data;

        // dynamic importでSSRを回避
        const { pdf } = await import("@react-pdf/renderer");
        const { InvoicePDFDocument } = await import("./invoice-pdf");
        const { createElement } = await import("react");

        const doc = createElement(InvoicePDFDocument, {
          invoice,
          items,
          company,
          customerName,
        });

        const blob = await pdf(doc as Parameters<typeof pdf>[0]).toBlob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${invoiceNumber}.pdf`;
        a.click();
        URL.revokeObjectURL(url);
        setGenerated(true);
        toast.success("PDFをダウンロードしました");
      } catch (e) {
        console.error(e);
        toast.error("PDF生成に失敗しました");
      }
    });
  }

  return (
    <Button
      size="sm"
      variant={generated ? "outline" : "default"}
      onClick={handleDownload}
      disabled={isPending}
      className="gap-1"
    >
      {isPending
        ? <><Loader2 className="w-3 h-3 animate-spin" />生成中...</>
        : <><FileDown className="w-3 h-3" />PDF</>
      }
    </Button>
  );
}
