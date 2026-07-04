/**
 * FastAPI backend client
 * BASE_URL は環境変数 NEXT_PUBLIC_API_URL で設定（デフォルト: localhost:8000）
 */

const BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type ParsedLine = {
  store: string;
  item: string;
  spec: string;
  unit: number;
  boxes: number;
  remainder: number;
  confidence: number;
};

export type ParseResponse = {
  verification_id: string;
  parsed_lines: ParsedLine[];
  confidence_flags: Record<string, unknown>;
};

export type CorrectedLine = {
  store: string;
  item: string;
  spec: string;
  unit: number;
  boxes: number;
  remainder: number;
};

export type VerifyRequest = {
  verification_id: string;
  order_date: string;        // YYYY-MM-DD
  corrected_lines: CorrectedLine[];
  correction_notes?: string;
  reviewed_by?: string;      // user.id from Next.js auth
};

export type VerifyResponse = {
  order_id: string;
};

async function apiFetch<T>(
  path: string,
  options?: RequestInit & { timeoutMs?: number }
): Promise<T> {
  const { timeoutMs = 120_000, ...fetchOptions } = options ?? {};
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("timeout"), timeoutMs);

  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      ...fetchOptions,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(fetchOptions?.headers ?? {}),
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      // FastAPI の {"detail": "..."} 形式を取り出す
      try {
        const json = JSON.parse(text);
        if (json?.detail) throw new Error(json.detail);
      } catch (parseErr) {
        if (parseErr instanceof Error && parseErr.message !== text) throw parseErr;
      }
      throw new Error(`API ${path} failed (${res.status}): ${text}`);
    }
    return res.json() as Promise<T>;
  } catch (err) {
    if (err instanceof Error) {
      if (err.name === "AbortError" || String(err).includes("timeout")) {
        throw new Error(`API ${path} タイムアウト (${timeoutMs / 1000}秒超過)`);
      }
      if (
        err.message.includes("ECONNREFUSED") ||
        err.message.includes("fetch failed") ||
        err.message.includes("Failed to fetch")
      ) {
        throw new Error(
          `バックエンドサーバーに接続できません (${BASE_URL})。サーバーが起動しているか確認してください。`
        );
      }
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Gemini でFAX画像を解析 */
export async function parseVerification(
  verificationId: string
): Promise<ParseResponse> {
  return apiFetch<ParseResponse>("/api/ocr/parse", {
    method: "POST",
    body: JSON.stringify({ verification_id: verificationId }),
    timeoutMs: 180_000, // Gemini は最大3分
  });
}

/** 人間確認済み行を承認し注文を作成 */
export async function verifyOcr(req: VerifyRequest): Promise<VerifyResponse> {
  return apiFetch<VerifyResponse>("/api/ocr/verify", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

/** 出荷ラベル PDF の Blob を取得 */
export async function fetchPdfBlob(orderId: string, reverseStoreOrder = false): Promise<Blob> {
  const url = `${BASE_URL}/api/orders/${orderId}/pdf${reverseStoreOrder ? "?reverse=1" : ""}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`PDF fetch failed (${res.status})`);
  }
  return res.blob();
}

/** 品目別出荷票（パック作業用の出荷表カード）PDF の Blob を取得 */
export async function fetchShippingSheetPdfBlob(params: {
  date: string; // YYYY-MM-DD（単日）
  productId?: string;
}): Promise<Blob> {
  const qs = new URLSearchParams({ target_date: params.date });
  if (params.productId) qs.set("product_id", params.productId);
  const res = await fetch(`${BASE_URL}/api/orders/shipping-sheet/pdf?${qs}`);
  if (res.status === 404) {
    throw new Error("NO_DATA");
  }
  if (!res.ok) {
    throw new Error(`出荷票PDFの取得に失敗しました (${res.status})`);
  }
  return res.blob();
}

/** IMAP メール取得トリガー */
export async function fetchEmails(): Promise<{ fetched: number }> {
  return apiFetch<{ fetched: number }>("/api/email/fetch");
}
