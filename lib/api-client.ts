/**
 * FastAPI backend client — **サーバー専用**
 *
 * ブラウザから直接 FastAPI を叩かない。理由は2つある：
 *
 * 1. バックエンドは Supabase のアクセストークンを要求する（backend/app/auth.py）。
 *    トークンは httpOnly クッキーにあり、サーバー側でしか読み出せない。
 * 2. ブラウザから直接叩くと NEXT_PUBLIC_API_URL でバックエンドの所在が公開され、
 *    Server Action 側で掛けている認可（管理者チェック・テナント境界）を
 *    素通りする経路ができてしまう。
 *
 * クライアントコンポーネントからバックエンドを使いたい場合は、
 * Server Action（app/actions/）か Route Handler（app/api/）を経由させる。
 */

import "server-only";

import { createClient } from "@/lib/supabase/server";

const BASE_URL = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

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

/**
 * ログイン中ユーザーのアクセストークン。未ログインなら null。
 *
 * getUser() を先に呼ぶのは検証と（必要なら）リフレッシュを走らせるため。
 * これを飛ばすと期限切れのトークンをそのまま送ってしまい、
 * バックエンドで 401 になる。
 */
async function getAccessToken(): Promise<string | null> {
  const supabase = await createClient();
  const { data: userData, error } = await supabase.auth.getUser();
  if (error || !userData.user) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

class UnauthenticatedError extends Error {
  constructor() {
    super("ログインが必要です。再度ログインしてください。");
    this.name = "UnauthenticatedError";
  }
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getAccessToken();
  if (!token) throw new UnauthenticatedError();
  return { Authorization: `Bearer ${token}` };
}

/** バックエンドのエラー応答から表示可能なメッセージを取り出す。 */
async function readErrorMessage(res: Response, path: string): Promise<string> {
  const text = await res.text().catch(() => res.statusText);
  try {
    const json = JSON.parse(text);
    if (json?.detail) {
      return typeof json.detail === "string" ? json.detail : JSON.stringify(json.detail);
    }
  } catch {
    // JSON でなければ本文をそのまま使う
  }
  if (res.status === 401) return "ログインの有効期限が切れています。再度ログインしてください。";
  if (res.status === 403) return "この操作の権限がありません。";
  return `API ${path} failed (${res.status}): ${text}`;
}

function describeNetworkError(err: unknown, timeoutMs: number, path: string): Error {
  if (err instanceof UnauthenticatedError) return err;
  if (err instanceof Error) {
    if (err.name === "AbortError" || String(err).includes("timeout")) {
      return new Error(`API ${path} タイムアウト (${timeoutMs / 1000}秒超過)`);
    }
    if (
      err.message.includes("ECONNREFUSED") ||
      err.message.includes("fetch failed") ||
      err.message.includes("Failed to fetch")
    ) {
      return new Error(
        `バックエンドサーバーに接続できません (${BASE_URL})。サーバーが起動しているか確認してください。`
      );
    }
  }
  return err instanceof Error ? err : new Error(String(err));
}

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
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        ...(await authHeaders()),
        ...(fetchOptions?.headers ?? {}),
      },
    });
    if (!res.ok) {
      throw new Error(await readErrorMessage(res, path));
    }
    return res.json() as Promise<T>;
  } catch (err) {
    throw describeNetworkError(err, timeoutMs, path);
  } finally {
    clearTimeout(timer);
  }
}

/** バイナリ（PDF）を取得する。Route Handler からストリームするために Response を返す。 */
async function apiFetchBinary(
  path: string,
  timeoutMs = 120_000
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("timeout"), timeoutMs);
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      signal: controller.signal,
      cache: "no-store",
      headers: await authHeaders(),
    });
    return res;
  } catch (err) {
    throw describeNetworkError(err, timeoutMs, path);
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

/** 出荷ラベル PDF（Route Handler でそのまま中継する） */
export async function fetchPdfResponse(
  orderId: string,
  reverseStoreOrder = false
): Promise<Response> {
  return apiFetchBinary(
    `/api/orders/${orderId}/pdf${reverseStoreOrder ? "?reverse=1" : ""}`
  );
}

/** 品目別出荷票（パック作業用の出荷表カード）PDF */
export async function fetchShippingSheetResponse(params: {
  date: string; // YYYY-MM-DD（単日）
  productId?: string;
  paperSize?: "A4" | "A5";
}): Promise<Response> {
  const qs = new URLSearchParams({
    target_date: params.date,
    paper_size: params.paperSize ?? "A4",
  });
  if (params.productId) qs.set("product_id", params.productId);
  return apiFetchBinary(`/api/orders/shipping-sheet/pdf?${qs}`);
}

/** IMAP メール取得トリガー */
export async function fetchEmails(): Promise<{ fetched: number }> {
  return apiFetch<{ fetched: number }>("/api/email/fetch");
}

// ─── Config（設定画面。管理者のみ。バックエンドでも require_admin で再確認される）───

export async function getBackendConfig<T>(path: string): Promise<T> {
  return apiFetch<T>(`/api/config/${path}`, { method: "GET" });
}

export async function putBackendConfig<T>(path: string, body: unknown): Promise<T> {
  return apiFetch<T>(`/api/config/${path}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export async function postBackendConfig<T>(path: string, body: unknown): Promise<T> {
  return apiFetch<T>(`/api/config/${path}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}
