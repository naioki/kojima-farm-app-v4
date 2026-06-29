"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Save, Loader2, Mail, TestTube2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { PromptConfigCard } from "./_components/prompt-config-card";
import { CompanySettingsCard } from "./_components/company-settings-card";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

interface EmailConfig {
  imap_server: string;
  imap_port: number;
  email_address: string;
  sender_email: string;
  days_back: number;
  password?: string;
}

interface ChatConfig {
  discord_webhook_url: string;
  line_works_bot_id: string;
  line_works_api_token: string;
  google_chat_webhook_url: string;
  allowed_line_users: string;
  allowed_discord_users: string;
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
  const [chatConfig, setChatConfig] = useState<ChatConfig>({
    discord_webhook_url: "",
    line_works_bot_id: "",
    line_works_api_token: "",
    google_chat_webhook_url: "",
    allowed_line_users: "",
    allowed_discord_users: "",
  });
  const [loading, setLoading] = useState(true);
  const [isSaving, startSave] = useTransition();
  const [isSavingChat, startSaveChat] = useTransition();
  const [isTesting, startTest] = useTransition();

  // 現在の設定を取得
  useEffect(() => {
    // メール設定取得
    fetch(`${API_URL}/api/config/email`)
      .then((r) => r.json())
      .then((data) => {
        setConfig((prev) => ({ ...prev, ...data, password: "" }));
      })
      .catch(() => toast.error("メール設定の取得に失敗しました"));

    // チャット設定取得
    fetch(`${API_URL}/api/config/chat`)
      .then((r) => r.json())
      .then((data) => {
        setChatConfig(data);
      })
      .catch(() => toast.error("チャット連携設定の取得に失敗しました"))
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
        try {
          const saved = await res.json();
          toast.success("メール設定を保存しました");
          // レスポンスで確定値に更新（パスワードは非返却なのでクリアのみ）
          setConfig((prev) => ({ ...prev, ...saved, password: "" }));
        } catch {
          toast.success("メール設定を保存しました");
        }
      } else {
        let errDetail = "サーバーエラーが発生しました";
        try {
          const err = await res.json();
          errDetail = err.detail || errDetail;
        } catch {
          errDetail = await res.text().catch(() => res.statusText);
        }
        toast.error("保存に失敗しました", { description: errDetail });
      }
    });
  }

  function handleTest() {
    startTest(async () => {
      toast.info("メール接続をテスト中...");
      try {
        const res = await fetch(`${API_URL}/api/email/fetch`, { method: "GET" });
        if (res.ok) {
          try {
            const data = await res.json();
            toast.success(`接続成功！ ${data.fetched} 件の画像を取得しました`);
          } catch {
            toast.success("接続テストに成功しました");
          }
        } else {
          let errDetail = "接続に失敗しました";
          try {
            const data = await res.json();
            errDetail = data.detail || errDetail;
          } catch {
            errDetail = await res.text().catch(() => res.statusText);
          }
          toast.error("接続失敗", { description: errDetail });
        }
      } catch {
        toast.error("バックエンドに接続できません");
      }
    });
  }

  function handleSaveChat() {
    startSaveChat(async () => {
      const res = await fetch(`${API_URL}/api/config/chat`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(chatConfig),
      });

      if (res.ok) {
        try {
          const saved = await res.json();
          toast.success("チャット連携設定を保存しました");
          setChatConfig(saved);
        } catch {
          toast.success("チャット連携設定を保存しました");
        }
      } else {
        let errDetail = "サーバーエラーが発生しました";
        try {
          const err = await res.json();
          errDetail = err.detail || errDetail;
        } catch {
          errDetail = await res.text().catch(() => res.statusText);
        }
        toast.error("チャット連携設定の保存に失敗しました", { description: errDetail });
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

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            🚀 チャット連携設定（LINE Works / Discord / Google Chat）
          </CardTitle>
          <CardDescription>
            各チャットボットやWebhookとの通知・承認連携の設定です。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Google Chat */}
          <div className="space-y-3">
            <h3 className="font-semibold text-sm text-primary">● Google Chat 連携</h3>
            <div className="space-y-2">
              <Label>Google Chat Webhook URL</Label>
              <Input
                placeholder="https://chat.googleapis.com/v1/spaces/..."
                value={chatConfig.google_chat_webhook_url ?? ""}
                onChange={(e) => setChatConfig((p) => ({ ...p, google_chat_webhook_url: e.target.value }))}
              />
            </div>
          </div>

          <Separator />

          {/* Discord */}
          <div className="space-y-3">
            <h3 className="font-semibold text-sm text-primary">● Discord 連携</h3>
            <div className="space-y-2">
              <Label>Discord Webhook URL</Label>
              <Input
                placeholder="https://discord.com/api/webhooks/..."
                value={chatConfig.discord_webhook_url ?? ""}
                onChange={(e) => setChatConfig((p) => ({ ...p, discord_webhook_url: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>操作を許可する Discord ユーザーID（カンマ区切り、空欄で制限なし）</Label>
              <Input
                placeholder="123456789012345678, 987654321098765432"
                value={chatConfig.allowed_discord_users ?? ""}
                onChange={(e) => setChatConfig((p) => ({ ...p, allowed_discord_users: e.target.value }))}
              />
            </div>
          </div>

          <Separator />

          {/* LINE Works */}
          <div className="space-y-3">
            <h3 className="font-semibold text-sm text-primary">● LINE Works 連携</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>LINE Works Bot ID</Label>
                <Input
                  placeholder="123456"
                  value={chatConfig.line_works_bot_id ?? ""}
                  onChange={(e) => setChatConfig((p) => ({ ...p, line_works_bot_id: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>LINE Works API トークン</Label>
                <Input
                  placeholder="ey..."
                  value={chatConfig.line_works_api_token ?? ""}
                  onChange={(e) => setChatConfig((p) => ({ ...p, line_works_api_token: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>操作を許可する LINE Works ユーザーID（カンマ区切り、空欄で制限なし）</Label>
              <Input
                placeholder="user_id_1, user_id_2"
                value={chatConfig.allowed_line_users ?? ""}
                onChange={(e) => setChatConfig((p) => ({ ...p, allowed_line_users: e.target.value }))}
              />
            </div>
          </div>

          <Separator />

          <Button onClick={handleSaveChat} disabled={isSavingChat} className="w-full">
            {isSavingChat ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
            チャット連携設定を保存
          </Button>
        </CardContent>
      </Card>

      {/* 会社情報 */}
      <CompanySettingsCard />

      {/* AI プロンプト設定 */}
      <PromptConfigCard />
    </div>
  );
}

