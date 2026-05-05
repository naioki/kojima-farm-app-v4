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
};

export type VerifyResponse = {
  order_id: string;
};

async function apiFetch<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`API ${path} failed (${res.status}): ${text}`);
  }
  return res.json() as Promise<T>;
}

/** Gemini でFAX画像を解析 */
export async function parseVerification(
  verificationId: string
): Promise<ParseResponse> {
  return apiFetch<ParseResponse>("/api/ocr/parse", {
    method: "POST",
    body: JSON.stringify({ verification_id: verificationId }),
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
export async function fetchPdfBlob(orderId: string): Promise<Blob> {
  const res = await fetch(`${BASE_URL}/api/orders/${orderId}/pdf`);
  if (!res.ok) {
    throw new Error(`PDF fetch failed (${res.status})`);
  }
  return res.blob();
}

/** IMAP メール取得トリガー */
export async function fetchEmails(): Promise<{ fetched: number }> {
  return apiFetch<{ fetched: number }>("/api/email/fetch");
}
