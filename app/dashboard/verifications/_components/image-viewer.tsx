"use client";

import { useState, useTransition } from "react";
import Image from "next/image";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  AlertTriangle, CheckCircle, Clock, FileText, XCircle,
  Mail, User, Calendar, Sparkles, Edit3, Eye,
} from "lucide-react";
import type { PendingVerification } from "@/app/actions/ocr-actions";
import { updateRawText, parseOcrVerification } from "@/app/actions/ocr-actions";

interface ImageViewerProps {
  verification: PendingVerification;
  onParsed?: (parsedLines: PendingVerification["parsed_lines"]) => void;
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "needs_review":
      return (
        <Badge className="gap-1 bg-amber-100 text-amber-800 border-amber-300">
          <AlertTriangle className="h-3 w-3" />要確認
        </Badge>
      );
    case "corrected":
      return (
        <Badge className="gap-1 bg-green-100 text-green-800 border-green-300">
          <CheckCircle className="h-3 w-3" />承認済
        </Badge>
      );
    case "auto_accepted":
      return (
        <Badge className="gap-1 bg-blue-100 text-blue-800 border-blue-300">
          <CheckCircle className="h-3 w-3" />自動承認
        </Badge>
      );
    case "rejected":
      return (
        <Badge className="gap-1 bg-gray-100 text-gray-600 border-gray-300">
          <XCircle className="h-3 w-3" />却下
        </Badge>
      );
    default:
      return (
        <Badge className="gap-1 bg-yellow-100 text-yellow-800 border-yellow-300">
          <Clock className="h-3 w-3" />未処理
        </Badge>
      );
  }
}

export function ImageViewer({ verification, onParsed }: ImageViewerProps) {
  const isText = verification.image_url.startsWith("text://");
  const flags = verification.confidence_flags as Record<string, unknown>;
  const subject = flags?.subject as string | undefined;
  const from = flags?.from as string | undefined;
  const rawText = (flags?.raw_text as string | undefined) ?? "";
  const emailDate = flags?.date as string | undefined;

  const [editMode, setEditMode] = useState(false);
  const [editedText, setEditedText] = useState(() => rawText.replace(/\r\n/g, "\n").replace(/\r/g, "\n"));
  const [isSaving, startSave] = useTransition();
  const [isParsing, startParse] = useTransition();

  function toastError(title: string, detail: string) {
    toast.error(title, {
      description: detail,
      action: {
        label: "コピー",
        onClick: () => navigator.clipboard.writeText(`${title}\n${detail}`),
      },
      duration: 10000,
    });
  }

  function handleSaveAndParse() {
    startSave(async () => {
      // 編集テキストをDBに保存
      const saveResult = await updateRawText(verification.id, editedText);
      if (!saveResult.success) {
        toastError("テキストの保存に失敗しました", saveResult.error);
        return;
      }
      setEditMode(false);
      // Gemini 解析
      startParse(async () => {
        const parseResult = await parseOcrVerification(verification.id);
        if (parseResult.success) {
          toast.success("Gemini 解析が完了しました", {
            description: `${parseResult.data.parsed_lines.length} 行を読み取りました`,
          });
          onParsed?.(parseResult.data.parsed_lines as unknown as PendingVerification["parsed_lines"]);
        } else {
          toastError("Gemini 解析に失敗しました", parseResult.error);
        }
      });
    });
  }

  const isLoading = isSaving || isParsing;

  return (
    <Card className="h-full flex flex-col overflow-hidden">
      {/* ヘッダー */}
      <CardHeader className="pb-2 pt-3 px-4 border-b bg-muted/30 shrink-0">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {isText ? (
              <div className="flex items-center gap-1.5 text-blue-600 shrink-0">
                <Mail className="h-4 w-4" />
                <span className="text-sm font-semibold">メール注文</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-purple-600 shrink-0">
                <FileText className="h-4 w-4" />
                <span className="text-sm font-semibold">受注票画像</span>
              </div>
            )}
          </div>
          <StatusBadge status={verification.status} />
        </div>

        {/* メタ情報 */}
        <div className="space-y-1 mt-1.5">
          {subject && (
            <p className="text-sm font-semibold text-foreground leading-snug truncate" title={subject}>
              {subject}
            </p>
          )}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {from && (
              <span className="flex items-center gap-1 min-w-0">
                <User className="h-3 w-3 shrink-0" />
                <span className="truncate max-w-[180px]" title={from}>{from}</span>
              </span>
            )}
            {emailDate && (
              <span className="flex items-center gap-1 shrink-0">
                <Calendar className="h-3 w-3" />
                {new Date(emailDate).toLocaleString("ja-JP", {
                  month: "numeric", day: "numeric",
                  hour: "2-digit", minute: "2-digit",
                })}
              </span>
            )}
            {!emailDate && (
              <span className="flex items-center gap-1 shrink-0">
                <Calendar className="h-3 w-3" />
                {new Date(verification.created_at).toLocaleDateString("ja-JP")}
              </span>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex-1 p-0 overflow-hidden flex flex-col">
        {isText ? (
          <div className="flex flex-col flex-1 overflow-hidden">
            {/* ツールバー */}
            <div className="flex items-center justify-between px-4 py-2 border-b bg-background shrink-0">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                メール本文
              </span>
              <div className="flex items-center gap-2">
                {editMode ? (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => { setEditedText(rawText); setEditMode(false); }}
                      disabled={isLoading}
                    >
                      <Eye className="h-3 w-3 mr-1" />キャンセル
                    </Button>
                    <Button
                      size="sm"
                      className="h-7 text-xs bg-blue-600 hover:bg-blue-700 text-white"
                      onClick={handleSaveAndParse}
                      disabled={isLoading}
                    >
                      <Sparkles className="h-3 w-3 mr-1" />
                      {isLoading ? "解析中..." : "このテキストで解析"}
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setEditMode(true)}
                  >
                    <Edit3 className="h-3 w-3 mr-1" />編集・再解析
                  </Button>
                )}
              </div>
            </div>

            {/* 本文エリア */}
            <div className="flex-1 overflow-auto p-3">
              {editMode ? (
                <Textarea
                  value={editedText}
                  onChange={(e) => setEditedText(e.target.value)}
                  className="w-full h-full min-h-[300px] text-sm font-mono leading-relaxed resize-none border-blue-300 focus:border-blue-500"
                  disabled={isLoading}
                />
              ) : (
                <pre className="text-sm font-mono whitespace-pre-wrap leading-relaxed text-foreground">
                  {editedText || <span className="text-muted-foreground italic">（本文なし）</span>}
                </pre>
              )}
            </div>

            {/* 解析結果プレビュー */}
            {verification.parsed_lines.length > 0 && (
              <div className="border-t shrink-0">
                <div className="px-4 py-2 bg-muted/30 flex items-center gap-2">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    解析結果
                  </span>
                  <Badge variant="outline" className="text-xs h-5">
                    {verification.parsed_lines.length} 行
                  </Badge>
                </div>
                <div className="max-h-48 overflow-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-muted sticky top-0">
                      <tr>
                        <th className="px-3 py-1.5 text-left font-semibold text-muted-foreground">店舗</th>
                        <th className="px-3 py-1.5 text-left font-semibold text-muted-foreground">品目</th>
                        <th className="px-3 py-1.5 text-left font-semibold text-muted-foreground">規格</th>
                        <th className="px-3 py-1.5 text-right font-semibold text-muted-foreground">箱</th>
                        <th className="px-3 py-1.5 text-right font-semibold text-muted-foreground">バラ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {verification.parsed_lines.map((line, idx) => (
                        <tr key={idx} className="border-t hover:bg-muted/50 transition-colors">
                          <td className="px-3 py-1.5 font-medium">{line.store || "—"}</td>
                          <td className="px-3 py-1.5">{line.item}</td>
                          <td className="px-3 py-1.5 text-muted-foreground">{line.spec || "—"}</td>
                          <td className="px-3 py-1.5 text-right font-mono">{line.boxes > 0 ? line.boxes : "—"}</td>
                          <td className="px-3 py-1.5 text-right font-mono">{line.remainder > 0 ? line.remainder : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        ) : (
          /* 画像メール */
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="relative flex-1 min-h-[300px] bg-muted">
              <Image
                src={verification.image_url}
                alt="受注票 OCR 画像"
                fill
                className="object-contain"
                sizes="(max-width: 768px) 100vw, 50vw"
              />
            </div>
            {verification.parsed_lines.length > 0 && (
              <div className="border-t shrink-0">
                <div className="px-4 py-2 bg-muted/30 flex items-center gap-2">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    OCR 読み取り結果
                  </span>
                  <Badge variant="outline" className="text-xs h-5">
                    {verification.parsed_lines.length} 行
                  </Badge>
                </div>
                <div className="max-h-48 overflow-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-muted sticky top-0">
                      <tr>
                        <th className="px-3 py-1.5 text-left font-semibold text-muted-foreground">店舗</th>
                        <th className="px-3 py-1.5 text-left font-semibold text-muted-foreground">品目</th>
                        <th className="px-3 py-1.5 text-left font-semibold text-muted-foreground">規格</th>
                        <th className="px-3 py-1.5 text-right font-semibold text-muted-foreground">箱</th>
                        <th className="px-3 py-1.5 text-right font-semibold text-muted-foreground">バラ</th>
                        <th className="px-3 py-1.5 text-right font-semibold text-muted-foreground">合計</th>
                      </tr>
                    </thead>
                    <tbody>
                      {verification.parsed_lines.map((line, idx) => (
                        <tr key={idx} className="border-t hover:bg-muted/50 transition-colors">
                          <td className="px-3 py-1.5 font-medium">{line.store || "—"}</td>
                          <td className="px-3 py-1.5">{line.item}</td>
                          <td className="px-3 py-1.5 text-muted-foreground">{line.spec || "—"}</td>
                          <td className="px-3 py-1.5 text-right font-mono">{line.boxes}</td>
                          <td className="px-3 py-1.5 text-right font-mono">{line.remainder}</td>
                          <td className="px-3 py-1.5 text-right font-mono font-semibold">{line.total_qty}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
