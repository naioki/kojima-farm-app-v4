/**
 * ブラウザ側のファイルダウンロード。
 *
 * 以前は各コンポーネントで下のように書かれていた：
 *
 *   a.href = url;
 *   a.click();
 *   URL.revokeObjectURL(url);   // ← click 直後に破棄
 *
 * `<a>` を DOM に入れず、click() の直後に Blob URL を破棄しているため、
 * Chrome では動くが Firefox / Safari ではダウンロードが中断されることがある。
 * ここに1か所だけ置いて、全画面で同じ挙動にする。
 */

/** レスポンスが JSON エラーだった場合にメッセージを取り出す。 */
async function extractErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const data = await res.json();
    if (typeof data?.error === "string") return data.error;
    if (typeof data?.detail === "string") return data.detail;
  } catch {
    // JSON でなければフォールバックを使う
  }
  return fallback;
}

/** ダウンロードが「対象データなし」で失敗したことを表す。呼び出し側で出し分ける。 */
export class NoDataError extends Error {
  constructor(message = "対象のデータがありません。") {
    super(message);
    this.name = "NoDataError";
  }
}

/**
 * 同一オリジンの URL から PDF を取得してダウンロードさせる。
 * 認証はクッキーで運ばれるので、呼び出し側でトークンを扱う必要はない。
 */
export async function downloadFile(url: string, filename: string): Promise<void> {
  const res = await fetch(url, { cache: "no-store" });

  if (res.status === 404) {
    const message = await extractErrorMessage(res, "対象のデータがありません。");
    throw new NoDataError(message === "NO_DATA" ? undefined : message);
  }
  if (!res.ok) {
    throw new Error(await extractErrorMessage(res, `取得に失敗しました (${res.status})`));
  }

  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.rel = "noopener";
  // DOM に入れてから click する（Firefox は未挿入の要素の click を無視する）
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  // ダウンロードが始まるまで Blob URL を残す
  setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
}

/** 出荷ラベル PDF。日付があればファイル名に入れる。 */
export function downloadOrderLabelPdf(
  orderId: string,
  orderDate?: string,
  reverseStoreOrder = false
): Promise<void> {
  const dateStr = (orderDate ?? "").replace(/-/g, "");
  const filename = dateStr
    ? `出荷ラベル_${dateStr}.pdf`
    : `出荷ラベル_${orderId.slice(0, 8)}.pdf`;
  const query = reverseStoreOrder ? "?reverse=1" : "";
  return downloadFile(`/api/orders/${orderId}/pdf${query}`, filename);
}

/** 品目別出荷票 PDF。 */
export function downloadShippingSheetPdf(params: {
  date: string;
  productId?: string;
  paperSize?: "A4" | "A5";
  filename?: string;
}): Promise<void> {
  const qs = new URLSearchParams({ date: params.date });
  if (params.productId) qs.set("productId", params.productId);
  if (params.paperSize) qs.set("paperSize", params.paperSize);
  const filename =
    params.filename ?? `出荷票_${params.date.replace(/-/g, "")}.pdf`;
  return downloadFile(`/api/orders/shipping-sheet?${qs}`, filename);
}
