"use client";

import type { ElementType } from "react";
import Image from "next/image";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, CheckCircle, Clock, FileText } from "lucide-react";
import type { PendingVerification } from "@/app/actions/ocr-actions";

interface ImageViewerProps {
  verification: PendingVerification;
}

const statusConfig = {
  pending: {
    label: "未処理",
    variant: "secondary" as const,
    icon: Clock,
  },
  needs_review: {
    label: "要確認",
    variant: "destructive" as const,
    icon: AlertTriangle,
  },
} satisfies Record<
  PendingVerification["status"],
  { label: string; variant: "secondary" | "destructive"; icon: ElementType }
>;

/** text://... URL かどうか（テキストメール由来）を判定 */
function isTextEmail(imageUrl: string): boolean {
  return imageUrl.startsWith("text://");
}

/** confidence_flags から「実際の低信頼度フラグ数」を算出
 *  source / subject / email_id などのメタキーは除外する */
function countLowConfidenceFlags(flags: Record<string, unknown>): number {
  const META_KEYS = new Set(["source", "subject", "email_id", "warnings", "learned_stores"]);
  return Object.entries(flags).filter(([key, val]) => {
    if (META_KEYS.has(key)) return false;
    if (Array.isArray(val)) return val.length > 0;
    return Boolean(val);
  }).length;
}

export function ImageViewer({ verification }: ImageViewerProps) {
  const status = statusConfig[verification.status];
  const StatusIcon = status.icon;
  const isText = isTextEmail(verification.image_url);
  const flagCount = countLowConfidenceFlags(verification.confidence_flags);
  const subject = (verification.confidence_flags as Record<string, unknown>)?.subject as string | undefined;

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            {isText ? (
              <><FileText className="h-4 w-4 text-blue-500" />テキスト注文書</>
            ) : (
              "受注票画像"
            )}
          </CardTitle>
          <Badge variant={status.variant} className="gap-1">
            <StatusIcon className="h-3 w-3" />
            {status.label}
          </Badge>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
          <span>登録日: {new Date(verification.created_at).toLocaleDateString("ja-JP")}</span>
          {verification.reviewer?.display_name && (
            <span>担当: {verification.reviewer.display_name}</span>
          )}
          {subject && (
            <span className="text-blue-600 truncate max-w-[200px]" title={subject}>
              件名: {subject}
            </span>
          )}
          {flagCount > 0 && (
            <span className="text-yellow-600 flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" />
              {flagCount} 件の低信頼度
            </span>
          )}
        </div>
      </CardHeader>

      <CardContent className="flex-1 p-3">
        {isText ? (
          /* ── テキストメール: parsed_lines を読みやすく表示 ── */
          <div className="w-full h-full min-h-[300px] rounded-md border bg-muted/30 p-4 overflow-auto">
            <p className="text-xs font-semibold text-muted-foreground mb-3 uppercase tracking-wide">
              メール本文（テキスト注文）
            </p>
            {verification.parsed_lines.length > 0 ? (
              <div className="space-y-2">
                {/* 店舗ごとにグループ化して表示 */}
                {(() => {
                  const byStore: Record<string, typeof verification.parsed_lines> = {};
                  verification.parsed_lines.forEach((line) => {
                    const key = line.store || "（店舗不明）";
                    if (!byStore[key]) byStore[key] = [];
                    byStore[key].push(line);
                  });
                  return Object.entries(byStore).map(([store, lines]) => (
                    <div key={store} className="rounded border bg-background p-2">
                      <p className="text-xs font-semibold mb-1 text-foreground">{store}</p>
                      <ul className="space-y-0.5">
                        {lines.map((line, i) => (
                          <li key={i} className="text-xs text-muted-foreground">
                            {line.item}
                            {line.spec ? ` (${line.spec})` : ""}
                            {" — "}
                            {line.boxes > 0 && `${line.boxes}箱`}
                            {line.remainder > 0 && ` バラ${line.remainder}`}
                            {line.unit > 0 && ` × ${line.unit}`}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ));
                })()}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                解析結果なし。「Gemini 解析」ボタンを押してください。
              </p>
            )}
          </div>
        ) : (
          /* ── 画像メール: next/image で表示 ── */
          <div className="relative w-full h-full min-h-[500px] rounded-md overflow-hidden border bg-muted">
            <Image
              src={verification.image_url}
              alt="受注票 OCR 画像"
              fill
              className="object-contain"
              sizes="(max-width: 768px) 100vw, 50vw"
            />
          </div>
        )}
      </CardContent>

      {/* OCR 読み取り結果テーブル（画像メール or テキストでも既解析ありの場合） */}
      {verification.parsed_lines.length > 0 && !isText && (
        <div className="px-6 pb-4">
          <p className="text-xs font-medium text-muted-foreground mb-2">
            OCR 読み取り結果（{verification.parsed_lines.length} 行）
          </p>
          <div className="overflow-auto max-h-40 rounded border text-xs">
            <table className="w-full">
              <thead className="bg-muted sticky top-0">
                <tr>
                  <th className="px-2 py-1 text-left font-medium">店舗</th>
                  <th className="px-2 py-1 text-left font-medium">品目</th>
                  <th className="px-2 py-1 text-left font-medium">規格</th>
                  <th className="px-2 py-1 text-right font-medium">箱</th>
                  <th className="px-2 py-1 text-right font-medium">バラ</th>
                  <th className="px-2 py-1 text-right font-medium">合計</th>
                </tr>
              </thead>
              <tbody>
                {verification.parsed_lines.map((line, idx) => (
                  <tr key={idx} className="border-t hover:bg-muted/50">
                    <td className="px-2 py-1">{line.store}</td>
                    <td className="px-2 py-1">{line.item}</td>
                    <td className="px-2 py-1">{line.spec}</td>
                    <td className="px-2 py-1 text-right">{line.boxes}</td>
                    <td className="px-2 py-1 text-right">{line.remainder}</td>
                    <td className="px-2 py-1 text-right font-medium">{line.total_qty}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Card>
  );
}
