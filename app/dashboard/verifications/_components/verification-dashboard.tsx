"use client";

import { useState, useEffect, useRef, useMemo, useCallback, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, Loader2 } from "lucide-react";
import { VerificationList } from "./verification-list";
import { ImageViewer } from "./image-viewer";
import { VerificationForm } from "./verification-form";
import type { PendingVerification, MasterData } from "@/app/actions/ocr-actions";
import {
  DATE_RANGE_LABELS,
  filterVerifications,
  type DateRange,
} from "@/lib/verification";
import { cn } from "@/lib/utils";

type Filter = "pending" | "all";

interface VerificationDashboardProps {
  initialVerifications: PendingVerification[];
  masterData: MasterData;
  /** サーバー側で取得上限に達したか */
  truncated?: boolean;
  /** サーバー側で適用済みの期間（URL の range と一致する） */
  dateRange: DateRange;
}

export function VerificationDashboard({
  initialVerifications,
  masterData,
  truncated = false,
  dateRange,
}: VerificationDashboardProps) {
  const [verifications, setVerifications] = useState(initialVerifications);
  const [filter, setFilter] = useState<Filter>("pending");
  const [imageOpen, setImageOpen] = useState(true);
  // クリックで選ばれた id。実際の表示対象は下で filtered から導出する。
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // 再解析でフォームを作り直すための版数。key に混ぜて再マウントさせる。
  const [formRevision, setFormRevision] = useState(0);
  const formRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isRangeChanging, startRangeChange] = useTransition();

  /**
   * 期間の変更は URL を書き換えてサーバーに再取得させる。
   * 期間の絞り込みはサーバー側で行っているため、ここで state だけ変えても
   * 取得済みの窓の外は見えない。
   */
  function changeDateRange(range: DateRange) {
    if (range === dateRange) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("range", range);
    startRangeChange(() => {
      router.replace(`?${params.toString()}`, { scroll: false });
    });
  }

  useEffect(() => {
    setVerifications(initialVerifications);
  }, [initialVerifications]);

  // 件数バッジとリストで同じ絞り込みを通す。
  // 以前はバッジが全期間・リストが期間フィルタ後だったため、「未処理 5」と
  // 出ているのに3件しか見えない状態が起きていた。
  // 期間はサーバー側で適用済みなので、ここでは未処理／全件の切り替えのみ。
  const pendingList = useMemo(
    () => filterVerifications(verifications, { onlyPending: true, dateRange: "all" }),
    [verifications]
  );
  const allList = verifications;
  const filtered = filter === "pending" ? pendingList : allList;

  // 選択は state に持つが、実際に表示する対象は絞り込み結果から導出する。
  // effect で setState して補正すると余分な再レンダリングが連鎖するため、
  // 「選択が絞り込みから外れたら先頭に落ちる」を導出で表現する。
  // これにより、表示されていない行が選択されたままになることもない。
  const selected =
    filtered.find((v) => v.id === selectedId) ?? filtered[0] ?? null;

  function handleSelect(id: string) {
    setSelectedId(id);
    setImageOpen(true);
    // モバイルで選択後、少し下にスクロール
    setTimeout(() => {
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 100);
  }

  /**
   * 再解析の結果を反映する。
   *
   * 以前は ImageViewer の onParsed が呼び出し側から渡されておらず、
   * 「このテキストで解析」が成功トーストを出すのにフォームも解析結果
   * プレビューも古いまま、という状態だった。ユーザーは効いていないと判断して
   * もう一度押すため、Gemini のクォータを無駄に消費していた。
   */
  const handleParsed = useCallback(
    (verificationId: string, parsedLines: PendingVerification["parsed_lines"]) => {
      setVerifications((prev) =>
        prev.map((v) =>
          v.id === verificationId
            ? { ...v, parsed_lines: parsedLines, status: "needs_review" }
            : v
        )
      );
      setFormRevision((n) => n + 1);
    },
    []
  );

  /** 却下された受注票をリストから消さず、状態だけ更新して履歴に残す。 */
  const handleRejected = useCallback((verificationId: string) => {
    setVerifications((prev) =>
      prev.map((v) => (v.id === verificationId ? { ...v, status: "rejected" } : v))
    );
  }, []);

  const handleRestored = useCallback((verificationId: string) => {
    setVerifications((prev) =>
      prev.map((v) =>
        v.id === verificationId ? { ...v, status: "needs_review" } : v
      )
    );
  }, []);

  /**
   * 承認後に次の未処理へ進む。
   *
   * 以前は PDF ダウンロードの finally からこれが呼ばれていたため、
   * 「受注登録完了 / PDF を再ダウンロード」のカードが表示される前に
   * 次の受注票へ切り替わってしまい、PDF の取得に失敗した場合の
   * 再取得手段が UI から消えていた。今は完了カードの「次へ」から呼ぶ。
   */
  const handleAdvance = useCallback(
    (approvedId: string) => {
      setVerifications((prev) =>
        prev.map((v) =>
          v.id === approvedId ? { ...v, status: "corrected" } : v
        )
      );
      const nextPending = pendingList.find((v) => v.id !== approvedId);
      setSelectedId(nextPending?.id ?? null);
    },
    [pendingList]
  );

  const pendingCount = pendingList.length;

  // ── フィルタータブ（PC/モバイル共通）────────────────────────────
  const filterTabs = (
    <div className="sticky top-0 bg-background border-b z-10">
      <div className="flex">
        <button
          type="button"
          onClick={() => setFilter("pending")}
          aria-pressed={filter === "pending"}
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
          onClick={() => setFilter("all")}
          aria-pressed={filter === "all"}
          className={`flex-1 py-2.5 text-xs font-semibold transition-colors ${
            filter === "all"
              ? "border-b-2 border-primary text-primary"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          全件
          <span className="ml-1.5 text-muted-foreground text-[10px]">
            {allList.length}
          </span>
        </button>
      </div>
      <div className="flex items-center gap-1 px-3 py-2">
        {(["7d", "30d", "all"] as DateRange[]).map((range) => (
          <button
            key={range}
            type="button"
            onClick={() => changeDateRange(range)}
            disabled={isRangeChanging}
            aria-pressed={dateRange === range}
            className={`flex-1 text-[10px] py-1 rounded transition-colors disabled:opacity-60 ${
              dateRange === range
                ? "bg-primary text-primary-foreground font-semibold"
                : "bg-muted text-muted-foreground hover:text-foreground"
            }`}
          >
            {DATE_RANGE_LABELS[range]}
          </button>
        ))}
        {isRangeChanging && (
          <Loader2
            className="h-3 w-3 shrink-0 animate-spin text-muted-foreground"
            aria-label="読み込み中"
          />
        )}
      </div>
      {/* 取得上限に達した場合は黙って切り捨てず明示する。
          「古い分が見えていない」と気づけないと棚卸しで齟齬が出る。 */}
      {truncated && (
        <p className="border-t bg-amber-50 px-3 py-1.5 text-[10px] leading-snug text-amber-800">
          件数が多いため直近 {initialVerifications.length} 件のみ表示しています。
          {dateRange !== "7d" && "期間を短くすると全件を確認できます。"}
        </p>
      )}
    </div>
  );

  const formKey = selected ? `${selected.id}:${formRevision}` : "none";

  return (
    <>
      {/* ── PC レイアウト（md以上）: 3分割横並び ── */}
      <div className="hidden md:flex h-[calc(100vh-3.5rem)]">
        <aside className="w-80 shrink-0 border-r overflow-y-auto bg-background flex flex-col">
          {filterTabs}
          <VerificationList
            verifications={filtered}
            selectedId={selected?.id ?? null}
            onSelect={setSelectedId}
          />
        </aside>
        {selected ? (
          <div className="flex-1 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] overflow-hidden">
            <div className="overflow-y-auto border-r p-4">
              <ImageViewer
                key={selected.id}
                verification={selected}
                onParsed={handleParsed}
              />
            </div>
            <div className="overflow-y-auto p-4">
              <VerificationForm
                key={formKey}
                verification={selected}
                masterData={masterData}
                onAdvance={handleAdvance}
                onRejected={handleRejected}
                onRestored={handleRestored}
                hasNextPending={pendingList.some((v) => v.id !== selected.id)}
              />
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            <p className="text-sm">左のリストから受注票を選択してください</p>
          </div>
        )}
      </div>

      {/* ── モバイルレイアウト（md未満）: 縦スタック ── */}
      <div className="flex flex-col md:hidden min-h-[calc(100vh-3.5rem)] bg-background">
        {/* リスト */}
        <div className="border-b">
          {filterTabs}
          <VerificationList
            verifications={filtered}
            selectedId={selected?.id ?? null}
            onSelect={handleSelect}
          />
        </div>

        {selected && (
          <div ref={formRef} className="flex flex-col">
            {/* 画像（アコーディオン） */}
            <div className="border-b">
              <button
                type="button"
                onClick={() => setImageOpen((v) => !v)}
                aria-expanded={imageOpen}
                className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold bg-muted/40 hover:bg-muted/70 transition-colors"
              >
                <span>画像・詳細</span>
                <ChevronDown className={cn(
                  "h-4 w-4 text-muted-foreground transition-transform duration-200",
                  imageOpen && "rotate-180"
                )} />
              </button>
              {imageOpen && (
                <div className="p-4">
                  <ImageViewer
                    key={selected.id}
                    verification={selected}
                    onParsed={handleParsed}
                  />
                </div>
              )}
            </div>

            {/* フォーム（常に表示） */}
            <div className="p-4 flex-1">
              <VerificationForm
                key={formKey}
                verification={selected}
                masterData={masterData}
                onAdvance={handleAdvance}
                onRejected={handleRejected}
                onRestored={handleRestored}
                hasNextPending={pendingList.some((v) => v.id !== selected.id)}
              />
            </div>
          </div>
        )}
      </div>
    </>
  );
}
