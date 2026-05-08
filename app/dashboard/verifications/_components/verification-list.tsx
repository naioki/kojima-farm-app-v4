"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Clock, AlertTriangle, CheckCircle, XCircle, Mail, FileImage } from "lucide-react";
import type { PendingVerification } from "@/app/actions/ocr-actions";

interface VerificationListProps {
  verifications: PendingVerification[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

type StatusConfig = {
  icon: React.ReactNode;
  label: string;
  className: string;
};

function getStatusConfig(status: string): StatusConfig {
  switch (status) {
    case "needs_review":
      return {
        icon: <AlertTriangle className="h-3 w-3" />,
        label: "要確認",
        className: "bg-amber-100 text-amber-800 border-amber-300",
      };
    case "corrected":
      return {
        icon: <CheckCircle className="h-3 w-3" />,
        label: "承認済",
        className: "bg-green-100 text-green-700 border-green-300",
      };
    case "auto_accepted":
      return {
        icon: <CheckCircle className="h-3 w-3" />,
        label: "自動承認",
        className: "bg-blue-100 text-blue-700 border-blue-300",
      };
    case "rejected":
      return {
        icon: <XCircle className="h-3 w-3" />,
        label: "却下",
        className: "bg-muted text-muted-foreground border-border",
      };
    default:
      return {
        icon: <Clock className="h-3 w-3" />,
        label: "未処理",
        className: "bg-yellow-100 text-yellow-700 border-yellow-300",
      };
  }
}

function formatDate(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffH = diffMs / 3_600_000;
  if (diffH < 24) {
    return d.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
  }
  if (diffH < 24 * 7) {
    return d.toLocaleDateString("ja-JP", { weekday: "short", month: "numeric", day: "numeric" });
  }
  return d.toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" });
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
        <p className="text-sm">受注票はありません</p>
      </div>
    );
  }

  return (
    <div className="divide-y">
      {verifications.map((v) => {
        const isSelected = v.id === selectedId;
        const cfg = getStatusConfig(v.status);
        const isText = v.image_url?.startsWith("text://");
        const flags = v.confidence_flags as Record<string, unknown>;
        const subject = flags?.subject as string | undefined;
        const from = flags?.from as string | undefined;

        // Get unique store names (max 3) for preview
        const stores = Array.from(
          new Set(v.parsed_lines.map((l) => l.store).filter(Boolean))
        ).slice(0, 3);

        return (
          <button
            key={v.id}
            type="button"
            onClick={() => onSelect(v.id)}
            className={cn(
              "w-full px-4 py-3 text-left transition-colors hover:bg-muted/50 group",
              isSelected && "bg-primary/5 border-l-2 border-primary"
            )}
          >
            <div className="flex items-start gap-2.5">
              {/* Source icon */}
              <div className={cn(
                "mt-0.5 shrink-0 h-7 w-7 rounded-md flex items-center justify-center",
                isText ? "bg-blue-100 text-blue-600" : "bg-purple-100 text-purple-600"
              )}>
                {isText ? <Mail className="h-3.5 w-3.5" /> : <FileImage className="h-3.5 w-3.5" />}
              </div>

              <div className="flex-1 min-w-0">
                {/* Top row: status badge + date */}
                <div className="flex items-center justify-between gap-2 mb-0.5">
                  <Badge
                    variant="outline"
                    className={cn("text-[10px] px-1.5 py-0 h-4 gap-0.5 shrink-0", cfg.className)}
                  >
                    {cfg.icon}
                    {cfg.label}
                  </Badge>
                  <span className="text-[11px] text-muted-foreground shrink-0">
                    {formatDate(v.created_at)}
                  </span>
                </div>

                {/* Subject or ID */}
                <p className="text-xs font-medium text-foreground truncate leading-snug">
                  {subject || (from ? `${from}` : v.id.slice(0, 8) + "...")}
                </p>

                {/* Store preview OR line count */}
                {stores.length > 0 ? (
                  <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                    {stores.join(" · ")}
                    {v.parsed_lines.length > stores.length && (
                      <span> +{v.parsed_lines.length - stores.length}</span>
                    )}
                    <span className="ml-1">({v.parsed_lines.length}行)</span>
                  </p>
                ) : (
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {v.parsed_lines.length > 0 ? `${v.parsed_lines.length} 行` : "未解析"}
                  </p>
                )}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
