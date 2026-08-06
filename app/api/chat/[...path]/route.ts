/**
 * 外部チャットサービス（Discord / LINE Works / Google Chat）の Webhook を
 * 内部の FastAPI へ中継する。
 *
 * ## なぜ必要か
 *
 * 1コンテナ構成（`Dockerfile.allinone`）では FastAPI が 127.0.0.1 バインドに
 * なり外部から到達できない。一方 Webhook は**外部サービスから届く**必要がある
 * ため、公開ポートを持つ Next.js が受けて内部へ渡す。
 *
 * 2サービス構成のままなら `INTERNAL_API_ORIGIN` を設定しなければよい。
 * その場合このルートは 404 を返し、Webhook は従来どおりバックエンドの
 * URL を直接向く。
 *
 * ## 署名検証を壊さないための制約
 *
 * Discord は **リクエストボディの生バイト列**と `X-Signature-Ed25519` /
 * `X-Signature-Timestamp` ヘッダで Ed25519 署名を検証する（LINE Works の
 * HMAC も同様）。JSON をパースして再シリアライズすると空白や键の順序が
 * 変わって署名が一致しなくなるため、**ボディは一切加工せずバイト列のまま
 * 転送する**。ヘッダも署名関連を落とさないようそのまま渡す。
 */
import { NextResponse, type NextRequest } from "next/server";

/** 転送してはいけないヘッダ（ホップバイホップ、および宛先が変わるもの）。 */
const STRIPPED_HEADERS = new Set([
  "host",
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "proxy-authorization",
  "proxy-authenticate",
  "te",
  "trailer",
  // 生バイトをそのまま渡すので、圧縮済みの申告が残ると不整合になる
  "content-length",
  "content-encoding",
]);

function internalOrigin(): string | null {
  const origin = process.env.INTERNAL_API_ORIGIN;
  return origin && origin.trim() ? origin.replace(/\/$/, "") : null;
}

function forwardHeaders(request: NextRequest): Headers {
  const headers = new Headers();
  request.headers.forEach((value, key) => {
    if (!STRIPPED_HEADERS.has(key.toLowerCase())) headers.set(key, value);
  });
  return headers;
}

async function proxy(request: NextRequest, pathSegments: string[]) {
  const origin = internalOrigin();
  if (!origin) {
    // 2サービス構成では中継しない（Webhook はバックエンドを直接向く）
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const path = pathSegments.map(encodeURIComponent).join("/");
  const search = request.nextUrl.search;
  const target = `${origin}/api/chat/${path}${search}`;

  // 生バイトのまま読む（パースしない）
  const body =
    request.method === "GET" || request.method === "HEAD"
      ? undefined
      : await request.arrayBuffer();

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers: forwardHeaders(request),
      body,
      cache: "no-store",
      redirect: "manual",
    });
  } catch (err) {
    console.error("[chat-proxy] 内部APIへの転送に失敗:", err);
    return NextResponse.json(
      { error: "Bad gateway" },
      { status: 502 },
    );
  }

  // 応答もそのまま返す。Discord は 401 や 4xx の意味を見ている
  const responseHeaders = new Headers();
  const contentType = upstream.headers.get("content-type");
  if (contentType) responseHeaders.set("content-type", contentType);
  responseHeaders.set("cache-control", "no-store");

  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  return proxy(request, path);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  return proxy(request, path);
}
