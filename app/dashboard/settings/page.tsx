"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Save, Loader2, Mail, TestTube2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

interface EmailConfig {
  imap_server: string;
  imap_port: number;
  email_address: string;
  sender_email: string;
  days_back: number;
  password?: string;
}

export default function SettingsPage() {
  const [config, setConfig] = useState<EmailConfig>({
    imap_server: "",
    imap_port: 993,
    email_address: "",
    sender_email: "",
    days_back: 3,
    password: "",
  });
  const [loading, setLoading] = useState(true);
  const [isSaving, startSave] = useTransition();
  const [isTesting, startTest] = useTransition();

  // 現在の設定を取得
  useEffect(() => {
    fetch(`${API_URL}/api/config/email`)
      .then((r) => r.json())
      .then((data) => {
        setConfig((prev) => ({ ...prev, ...data, password: "" }));
      })
      .catch(() => toast.error("設定の取得に失敗しました"))
      .finally(() => setLoading(false));
  }, []);

  function handleSave() {
    startSave(async () => {
      const payload = { ...config };
      // パスワードが空の場合は送らない
      if (!payload.password) delete payload.password;

      const res = await fetch(`${API_URL}/api/config/email`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        toast.success("メール設定を保存しました");
        setConfig((prev) => ({ ...prev, password: "" }));
      } else {
        const err = await res.json();
        toast.error("保存に失敗しました", { description: err.detail });
      }
    });
  }

  function handleTest() {
    startTest(async () => {
      toast.info("メール接続をテスト中...");
      try {
        const res = await fetch(`${API_URL}/api/email/fetch`, { method: "GET" });
        const data = await res.json();
        if (res.ok) {
          toast.success(`接続成功！ ${data.fetched} 件の画像を取得しました`);
        } else {
          toast.error("接続失敗", { description: data.detail });
        }
      } catch {
        toast.error("バックエンドに接続できません");
      }
    });
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">設定</h1>
        <p className="text-sm text-muted-foreground mt-1">メールサーバー（IMAP）の接続設定</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            メール設定（IMAP）
          </CardTitle>
          <CardDescription>
            FAX 注文書を受信するメールボックスの設定です。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>IMAP サーバー *</Label>
              <Input
                placeholder="imap.lolipop.jp"
                value={config.imap_server}
                onChange={(e) => setConfig((p) => ({ ...p, imap_server: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>IMAP ポート</Label>
              <Input
                type="number"
                min={1}
                max={65535}
                value={config.imap_port}
                onChange={(e) => setConfig((p) => ({ ...p, imap_port: Number(e.target.value) }))}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>メールアカウント *</Label>
              <Input
                type="email"
                placeholder="order@kojimanouen.com"
                value={config.email_address}
                onChange={(e) => setConfig((p) => ({ ...p, email_address: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>受信日数</Label>
              <Input
                type="number"
                min={1}
                max={30}
                value={config.days_back}
                onChange={(e) => setConfig((p) => ({ ...p, days_back: Number(e.target.value) }))}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>パスワード（変更する場合のみ入力）</Label>
            <Input
              type="password"
              placeholder="入力しない場合は変更されません"
              value={config.password ?? ""}
              onChange={(e) => setConfig((p) => ({ ...p, password: e.target.value }))}
            />
          </div>

          <div className="space-y-2">
            <Label>差出人フィルター（任意）</Label>
            <Input
              type="email"
              placeholder="fax@example.com（このアドレスのメールのみ処理）"
              value={config.sender_email ?? ""}
              onChange={(e) => setConfig((p) => ({ ...p, sender_email: e.target.value }))}
            />
          </div>

          <Separator />

          <div className="flex gap-3">
            <Button onClick={handleSave} disabled={isSaving || isTesting} className="flex-1">
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
              保存
            </Button>
            <Button
              variant="outline"
              onClick={handleTest}
              disabled={isSaving || isTesting}
              className="flex-1"
            >
              {isTesting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <TestTube2 className="h-4 w-4 mr-2" />}
              接続テスト & メール取得
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
