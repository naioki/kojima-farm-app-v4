"use client";

import { useState } from "react";
import { VerificationList } from "./verification-list";
import { ImageViewer } from "./image-viewer";
import { VerificationForm } from "./verification-form";
import type { PendingVerification } from "@/app/actions/ocr-actions";

interface VerificationDashboardProps {
  initialVerifications: PendingVerification[];
}

export function VerificationDashboard({
  initialVerifications,
}: VerificationDashboardProps) {
  const [verifications, setVerifications] = useState(initialVerifications);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialVerifications[0]?.id ?? null
  );

  const selected = verifications.find((v) => v.id === selectedId) ?? null;

  function handleApproved() {
    // 承認後: リストから除去し、次のアイテムを選択
    const remaining = verifications.filter((v) => v.id !== selectedId);
    setVerifications(remaining);
    setSelectedId(remaining[0]?.id ?? null);
  }

  return (
    <div className="flex h-[calc(100vh-3.5rem)]">
      {/* サイドバー: 一覧 */}
      <aside className="w-64 shrink-0 border-r overflow-y-auto bg-background">
        <div className="sticky top-0 bg-background border-b px-4 py-2.5 flex items-center justify-between">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            未処理
          </span>
          <span className="text-xs bg-muted rounded-full px-2 py-0.5">
            {verifications.length} 件
          </span>
        </div>
        <VerificationList
          verifications={verifications}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
      </aside>

      {/* メイン: 2カラム (画像 | フォーム) */}
      {selected ? (
        <div className="flex-1 grid grid-cols-2 gap-4 p-4 overflow-hidden">
          {/* 左: スティッキー画像ビューアー */}
          <div className="overflow-y-auto">
            <ImageViewer verification={selected} />
          </div>
          {/* 右: 動的フォーム */}
          <div className="overflow-y-auto">
            <VerificationForm
              key={selected.id}
              verification={selected}
              onApproved={handleApproved}
            />
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          <p className="text-sm">左のリストから受注票を選択してください</p>
        </div>
      )}
    </div>
  );
}
