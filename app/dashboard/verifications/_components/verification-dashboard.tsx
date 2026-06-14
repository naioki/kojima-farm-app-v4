"use client";

import { useState, useEffect } from "react";
import { VerificationList } from "./verification-list";
import { ImageViewer } from "./image-viewer";
import { VerificationForm } from "./verification-form";
import type { PendingVerification, MasterData } from "@/app/actions/ocr-actions";

type Filter = "pending" | "all";
type DateRange = "7d" | "30d" | "all";

const DATE_RANGE_LABELS: Record<DateRange, string> = {
  "7d": "7日",
  "30d": "30日",
  "all": "全期間",
};

const PENDING_STATUSES = ["pending", "needs_review"];

interface VerificationDashboardProps {
  initialVerifications: PendingVerification[];
  masterData: MasterData;
}

export function VerificationDashboard({
  initialVerifications,
  masterData,
}: VerificationDashboardProps) {
  const [verifications, setVerifications] = useState(initialVerifications);
  const [filter, setFilter] = useState<Filter>("pending");
  const [dateRange, setDateRange] = useState<DateRange>(() => {
    if (typeof window !== "undefined") {
      return (localStorage.getItem("verificationDateRange") as DateRange) ?? "30d";
    }
    return "30d";
  });

  function setDateRangeAndSave(range: DateRange) {
    setDateRange(range);
    localStorage.setItem("verificationDateRange", range);
  }

  function applyDateFilter(list: PendingVerification[]) {
    if (dateRange === "all") return list;
    const days = dateRange === "7d" ? 7 : 30;
    const cutoff = new Date(Date.now() - days * 86400000);
    return list.filter((v) => new Date(v.created_at) >= cutoff);
  }

  // サーバーサイドからのプロップ更新（メール取得など）をステートに同期する
  useEffect(() => {
    setVerifications(initialVerifications);
    setSelectedId((prev) => {
      const activeList = filter === "pending"
        ? initialVerifications.filter((v) => PENDING_STATUSES.includes(v.status))
        : initialVerifications;
      if (!prev || !initialVerifications.some((v) => v.id === prev)) {
        return activeList[0]?.id ?? initialVerifications[0]?.id ?? null;
      }
      return prev;
    });
  }, [initialVerifications, filter]);

  const filtered = applyDateFilter(
    filter === "pending"
      ? verifications.filter((v) => PENDING_STATUSES.includes(v.status))
      : verifications
  );

  const [selectedId, setSelectedId] = useState<string | null>(
    () => filtered[0]?.id ?? null
  );

  const selected = verifications.find((v) => v.id === selectedId) ?? null;

  function handleApproved() {
    const remaining = verifications.filter((v) => v.id !== selectedId);
    setVerifications(remaining);
    const nextPending = remaining.filter((v) => PENDING_STATUSES.includes(v.status));
    setSelectedId(nextPending[0]?.id ?? remaining[0]?.id ?? null);
  }

  const pendingCount = verifications.filter((v) =>
    PENDING_STATUSES.includes(v.status)
  ).length;

  return (
    <div className="flex h-[calc(100vh-3.5rem)]">
      {/* サイドバー */}
      <aside className="w-80 shrink-0 border-r overflow-y-auto bg-background flex flex-col">
        {/* フィルタタブ */}
        <div className="sticky top-0 bg-background border-b z-10">
          <div className="flex">
            <button
              type="button"
              onClick={() => {
                setFilter("pending");
                const first = verifications.find((v) => PENDING_STATUSES.includes(v.status));
                setSelectedId(first?.id ?? null);
              }}
              className={`flex-1 py-2.5 text-xs font-semibold transition-colors ${
                filter === "pending"
                  ? "border-b-2 border-primary text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              未処理
              {pendingCount > 0 && (
                <span className="ml-1.5 bg-primary text-primary-foreground rounded-full px-1.5 py-0.5 text-[10px]">
                  {pendingCount}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => {
                setFilter("all");
                setSelectedId(verifications[0]?.id ?? null);
              }}
              className={`flex-1 py-2.5 text-xs font-semibold transition-colors ${
                filter === "all"
                  ? "border-b-2 border-primary text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              全件
              <span className="ml-1.5 text-muted-foreground text-[10px]">
                {verifications.length}
              </span>
            </button>
          </div>
          {/* 日付フィルター */}
          <div className="flex gap-1 px-3 py-2">
            {(["7d", "30d", "all"] as DateRange[]).map((range) => (
              <button
                key={range}
                type="button"
                onClick={() => setDateRangeAndSave(range)}
                className={`flex-1 text-[10px] py-1 rounded transition-colors ${
                  dateRange === range
                    ? "bg-primary text-primary-foreground font-semibold"
                    : "bg-muted text-muted-foreground hover:text-foreground"
                }`}
              >
                {DATE_RANGE_LABELS[range]}
              </button>
            ))}
          </div>
        </div>

        <VerificationList
          verifications={filtered}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
      </aside>

      {/* メイン */}
      {selected ? (
        <div className="flex-1 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] overflow-hidden">
          <div className="overflow-y-auto border-r p-4">
            <ImageViewer key={selected.id} verification={selected} />
          </div>
          <div className="overflow-y-auto p-4">
            <VerificationForm
              key={selected.id}
              verification={selected}
              masterData={masterData}
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
