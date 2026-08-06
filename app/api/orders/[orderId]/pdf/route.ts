/**
 * 出荷ラベル PDF の中継。
 *
 * ブラウザは同一オリジンのこのルートを叩き、ここが Supabase のアクセストークンを
 * 付けて FastAPI へ転送する。バックエンドの URL とトークンをブラウザに出さずに
 * 済ませるための境界。
 */
import { NextResponse, type NextRequest } from "next/server";

import { fetchPdfResponse } from "@/lib/api-client";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const { orderId } = await params;
  const reverse = request.nextUrl.searchParams.get("reverse") === "1";

  let upstream: Response;
  try {
    upstream = await fetchPdfResponse(orderId, reverse);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "PDF の取得に失敗しました。" },
      { status: 502 }
    );
  }

  if (!upstream.ok) {
    // バックエンドの日本語メッセージ（404「受注が見つかりません。」等）をそのまま渡す
    const detail = await upstream.text().catch(() => "");
    let message = "PDF の取得に失敗しました。";
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
      "Content-Disposition": `attachment; filename="order-${orderId}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
