/**
 * 品目別出荷票（パック作業用の出荷表カード）PDF の中継。
 * 認証の扱いは app/api/orders/[orderId]/pdf/route.ts と同じ。
 */
import { NextResponse, type NextRequest } from "next/server";

import { fetchShippingSheetResponse } from "@/lib/api-client";

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const date = sp.get("date");
  if (!date) {
    return NextResponse.json({ error: "date は必須です。" }, { status: 400 });
  }

  const paperSizeParam = sp.get("paperSize");
  const paperSize = paperSizeParam === "A5" ? "A5" : "A4";

  let upstream: Response;
  try {
    upstream = await fetchShippingSheetResponse({
      date,
      productId: sp.get("productId") ?? undefined,
      paperSize,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "出荷票の取得に失敗しました。" },
      { status: 502 }
    );
  }

  // 対象日にデータが無い場合。呼び出し側で「該当なし」を出し分けるため 404 を保つ。
  if (upstream.status === 404) {
    return NextResponse.json({ error: "NO_DATA" }, { status: 404 });
  }

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => "");
    let message = "出荷票の取得に失敗しました。";
    try {
      const parsed = JSON.parse(detail);
      if (parsed?.detail) message = parsed.detail;
    } catch {
      if (detail) message = detail;
    }
    return NextResponse.json({ error: message }, { status: upstream.status });
  }

  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="shipping-sheet-${date}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
