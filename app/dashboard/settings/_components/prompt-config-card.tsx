"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  Save, Loader2, Sparkles, RotateCcw, History, FlaskConical,
  ShieldAlert, ShieldCheck, AlertTriangle, CheckCircle2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type Kind = "text" | "image";

interface PromptConfig {
  image_prompt: string | null;
  text_prompt: string | null;
  is_custom_enabled: boolean;
  version: number;
  default_image_prompt: string;
  default_text_prompt: string;
  required_image_placeholders: string[];
  required_text_placeholders: string[];
}

interface HistoryEntry {
  version: number;
  image_prompt: string | null;
  text_prompt: string | null;
  is_custom_enabled: boolean;
  saved_by: string | null;
  created_at: string | null;
}

interface TestResult {
  ok: boolean;
  missing_placeholders: string[];
  parsed: Record<string, unknown>[] | null;
  message: string;
}

export function PromptConfigCard() {
  const [cfg, setCfg] = useState<PromptConfig | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [tab, setTab] = useState<Kind>("text");
  const [imageDraft, setImageDraft] = useState("");
  const [textDraft, setTextDraft] = useState("");
  const [sampleText, setSampleText] = useState("");
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  const [loading, setLoading] = useState(true);
  const [isSaving, startSave] = useTransition();
  const [isTesting, startTest] = useTransition();

  useEffect(() => {
    fetch(`${API_URL}/api/config/prompt`)
      .then((r) => r.json())
      .then((data: PromptConfig) => {
        setCfg(data);
        setEnabled(data.is_custom_enabled);
        // カスタム値が無ければデフォルトを下書きの初期値に
        setImageDraft(data.image_prompt ?? data.default_image_prompt);
        setTextDraft(data.text_prompt ?? data.default_text_prompt);
      })
      .catch(() => toast.error("プロンプト設定の取得に失敗しました"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center h-32">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }
  if (!cfg) return null;

  const draft = tab === "text" ? textDraft : imageDraft;
  const setDraft = tab === "text" ? setTextDraft : setImageDraft;
  const required = tab === "text" ? cfg.required_text_placeholders : cfg.required_image_placeholders;
  const defaultPrompt = tab === "text" ? cfg.default_text_prompt : cfg.default_image_prompt;
  const missing = required.filter((ph) => !draft.includes(ph));
  const isValid = missing.length === 0;

  // 保存可否: カスタム有効時は両方のプロンプトが必須項目を満たすこと
  const imageMissing = cfg.required_image_placeholders.filter((ph) => !imageDraft.includes(ph));
  const textMissing = cfg.required_text_placeholders.filter((ph) => !textDraft.includes(ph));
  const canSave = !enabled || (imageMissing.length === 0 && textMissing.length === 0);

  function insertPlaceholder(ph: string) {
    setDraft((d) => d + (d.endsWith("\n") || d === "" ? "" : "\n") + ph);
  }

  function resetToDefault() {
    setDraft(defaultPrompt);
    toast.info(`${tab === "text" ? "テキスト" : "画像"}プロンプトを内蔵デフォルトに戻しました（未保存）`);
  }

  function handleTest() {
    startTest(async () => {
      setTestResult(null);
      try {
        const res = await fetch(`${API_URL}/api/config/prompt/test`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: tab, prompt: draft, sample_text: tab === "text" ? sampleText : null }),
        });
        const data: TestResult = await res.json();
        setTestResult(data);
        if (data.ok) toast.success(data.message || "検証OK");
        else toast.error(data.message || "検証に失敗しました");
      } catch {
        toast.error("テストに失敗しました（バックエンド未接続）");
      }
    });
  }

  function handleSave() {
    if (!canSave) {
      toast.error("必須項目が不足しているため保存できません");
      return;
    }
    startSave(async () => {
      const res = await fetch(`${API_URL}/api/config/prompt`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image_prompt: imageDraft,
          text_prompt: textDraft,
          is_custom_enabled: enabled,
        }),
      });
      if (res.ok) {
        const saved: PromptConfig = await res.json();
        setCfg((p) => (p ? { ...p, ...saved } : p));
        toast.success(`プロンプト設定を保存しました（v${saved.version}）`);
      } else {
        let detail = "保存に失敗しました";
        try { detail = (await res.json()).detail ?? detail; } catch {}
        toast.error("保存に失敗しました", { description: detail });
      }
    });
  }

  function loadHistory() {
    fetch(`${API_URL}/api/config/prompt/history`)
      .then((r) => r.json())
      .then(setHistory)
      .catch(() => toast.error("履歴の取得に失敗しました"));
  }

  function restoreFromHistory(h: HistoryEntry) {
    if (h.image_prompt != null) setImageDraft(h.image_prompt);
    if (h.text_prompt != null) setTextDraft(h.text_prompt);
    toast.info(`v${h.version} を編集欄に復元しました（保存ボタンで確定）`);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-5 w-5" />
          AI 解析プロンプト設定
        </CardTitle>
        <CardDescription>
          メール・FAX画像を解析する AI への指示文を編集します。
          誤った内容による業務停止を防ぐフェイルセーフ機能付きです。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* マスタースイッチ */}
        <div className={cn(
          "rounded-lg border p-4 flex items-start gap-3",
          enabled ? "border-amber-300 bg-amber-50" : "border-green-300 bg-green-50"
        )}>
          {enabled
            ? <ShieldAlert className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
            : <ShieldCheck className="h-5 w-5 text-green-600 mt-0.5 shrink-0" />
          }
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-3">
              <span className="font-semibold text-sm">
                {enabled ? "カスタムプロンプトを使用中" : "内蔵デフォルトを使用中（安全）"}
              </span>
              <button
                type="button"
                onClick={() => setEnabled((v) => !v)}
                className={cn(
                  "relative h-6 w-11 rounded-full transition-colors shrink-0",
                  enabled ? "bg-amber-500" : "bg-muted-foreground/30"
                )}
                role="switch"
                aria-checked={enabled}
              >
                <span className={cn(
                  "absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform",
                  enabled && "translate-x-5"
                )} />
              </button>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {enabled
                ? "下記の編集内容で解析されます。問題があれば即座にOFFで安全なデフォルトに戻せます。"
                : "OFFの間は編集内容に関係なく、動作確認済みの内蔵プロンプトで解析されます。"}
            </p>
          </div>
        </div>

        {/* タブ: テキスト / 画像 */}
        <Tabs value={tab} onValueChange={(v) => { setTab(v as Kind); setTestResult(null); }}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="text">メール（テキスト）</TabsTrigger>
            <TabsTrigger value="image">FAX（画像）</TabsTrigger>
          </TabsList>
        </Tabs>

        {/* 必須プレースホルダ */}
        <div className="space-y-2">
          <Label className="text-xs">必須項目（削除すると保存できません）</Label>
          <div className="flex flex-wrap gap-1.5">
            {required.map((ph) => {
              const present = draft.includes(ph);
              return (
                <button
                  key={ph}
                  type="button"
                  onClick={() => !present && insertPlaceholder(ph)}
                  disabled={present}
                  className={cn(
                    "text-[11px] font-mono px-2 py-0.5 rounded border transition-colors",
                    present
                      ? "bg-green-100 text-green-700 border-green-300 cursor-default"
                      : "bg-red-50 text-red-600 border-red-300 hover:bg-red-100"
                  )}
                  title={present ? "設定済み" : "クリックで挿入"}
                >
                  {present ? "✓ " : "＋ "}{ph}
                </button>
              );
            })}
          </div>
        </div>

        {/* エディタ */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs">プロンプト本文</Label>
            {isValid
              ? <Badge variant="outline" className="text-[10px] bg-green-50 text-green-700 border-green-300"><CheckCircle2 className="h-3 w-3 mr-1" />必須項目OK</Badge>
              : <Badge variant="outline" className="text-[10px] bg-red-50 text-red-600 border-red-300"><AlertTriangle className="h-3 w-3 mr-1" />必須項目不足</Badge>
            }
          </div>
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="font-mono text-xs h-72 resize-y leading-relaxed"
            spellCheck={false}
          />
        </div>

        {/* ドライランテスト */}
        <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
          <Label className="text-xs flex items-center gap-1.5">
            <FlaskConical className="h-3.5 w-3.5" />保存前テスト（ドライラン）
          </Label>
          {tab === "text" && (
            <Textarea
              value={sampleText}
              onChange={(e) => setSampleText(e.target.value)}
              placeholder="テスト用のメール本文を貼り付けると、実際に解析して結果を確認できます（任意）"
              className="text-xs h-20 resize-y"
            />
          )}
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={handleTest} disabled={isTesting} className="h-8">
              {isTesting ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <FlaskConical className="h-3.5 w-3.5 mr-1" />}
              テスト実行
            </Button>
            {testResult && (
              <span className={cn("text-xs", testResult.ok ? "text-green-600" : "text-red-600")}>
                {testResult.message}
              </span>
            )}
          </div>
          {testResult?.parsed && testResult.parsed.length > 0 && (
            <pre className="text-[10px] bg-background border rounded p-2 max-h-40 overflow-auto">
              {JSON.stringify(testResult.parsed, null, 2)}
            </pre>
          )}
        </div>

        <Separator />

        {/* アクション */}
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={handleSave} disabled={isSaving || !canSave} className="flex-1 min-w-[120px]">
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
            保存（v{cfg.version} → v{cfg.version + 1}）
          </Button>
          <Button type="button" variant="outline" onClick={resetToDefault} className="h-10">
            <RotateCcw className="h-4 w-4 mr-1.5" />デフォルトに戻す
          </Button>
          <Dialog>
            <DialogTrigger asChild>
              <Button type="button" variant="outline" onClick={loadHistory} className="h-10">
                <History className="h-4 w-4 mr-1.5" />履歴
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>変更履歴（ロールバック）</DialogTitle>
              </DialogHeader>
              <div className="max-h-96 overflow-auto divide-y">
                {history.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-6 text-center">履歴がありません</p>
                ) : history.map((h) => (
                  <div key={h.version} className="py-2.5 flex items-center gap-3">
                    <Badge variant="outline" className="text-[10px] shrink-0">v{h.version}</Badge>
                    <span className="text-xs text-muted-foreground flex-1 truncate">
                      {h.created_at ? new Date(h.created_at).toLocaleString("ja-JP") : "—"}
                      {h.is_custom_enabled ? " · カスタム" : " · デフォルト"}
                    </span>
                    <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => restoreFromHistory(h)}>
                      この版を復元
                    </Button>
                  </div>
                ))}
              </div>
              <DialogFooter>
                <p className="text-[11px] text-muted-foreground">
                  復元すると編集欄に読み込まれます。「保存」ボタンを押すまで本番には反映されません。
                </p>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
        {!canSave && (
          <p className="text-xs text-red-600 flex items-center gap-1">
            <AlertTriangle className="h-3.5 w-3.5" />
            {imageMissing.length > 0 && `画像: ${imageMissing.join(", ")} `}
            {textMissing.length > 0 && `テキスト: ${textMissing.join(", ")} `}
            が不足しています
          </p>
        )}
      </CardContent>
    </Card>
  );
}
