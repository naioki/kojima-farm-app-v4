"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Clock, AlertTriangle, ChevronRight } from "lucide-react";
import type { PendingVerification } from "@/app/actions/ocr-actions";

interface VerificationListProps {
  verifications: PendingVerification[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function VerificationList({
  verifications,
  selectedId,
  onSelect,
}: VerificationListProps) {
  if (verifications.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <Clock className="h-10 w-10 mb-3 opacity-40" />
        <p className="text-sm">未処理の受注票はありません</p>
      </div>
    );
  }

  return (
    <div className="divide-y">
      {verifications.map((v) => {
        const isSelected = v.id === selectedId;
        const isNeedsReview = v.status === "needs_review";
        const date = new Date(v.created_at).toLocaleDateString("ja-JP", {
          month: "short",
          day: "numeric",
        });

        return (
          <button
            key={v.id}
            type="button"
            onClick={() => onSelect(v.id)}
            className={cn(
              "w-full flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/60",
              isSelected && "bg-muted"
            )}
          >
            <div
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                isNeedsReview
                  ? "bg-destructive/10 text-destructive"
                  : "bg-yellow-100 text-yellow-700"
              )}
            >
              {isNeedsReview ? (
                <AlertTriangle className="h-4 w-4" />
              ) : (
                <Clock className="h-4 w-4" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-muted-foreground truncate">
                  {v.id.slice(0, 8)}...
                </span>
                <Badge
                  variant={isNeedsReview ? "destructive" : "secondary"}
                  className={`text-[10px] px-1.5 py-0 ${!isNeedsReview ? "bg-yellow-100 text-yellow-700 border-yellow-300" : ""}`}
                >
                  {isNeedsReview ? "要確認" : "未処理"}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {v.parsed_lines.length} 行 · {date}
              </p>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
          </button>
        );
      })}
    </div>
  );
}
