"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Save, Loader2, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { getCompanySettings, saveCompanySettings } from "@/app/actions/invoice-actions";
import type { CompanySettings } from "@/app/actions/invoice-actions";

const EMPTY: Partial<CompanySettings> = {
  company_name: "",
  company_name_kana: "",
  postal_code: "",
  address: "",
  tel: "",
  fax: "",
  email: "",
  invoice_reg_num: "",
  bank_info: "",
  rounding_rule: "floor",
  sales_basis: "order_date",
};

export function CompanySettingsCard() {
  const [form, setForm] = useState<Partial<CompanySettings>>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [isSaving, startSave] = useTransition();

  useEffect(() => {
    getCompanySettings().then((data) => {
      if (data) setForm(data);
      setLoading(false);
    });
  }, []);

  function set<K extends keyof CompanySettings>(k: K, v: CompanySettings[K]) {
    setForm((p) => ({ ...p, [k]: v }));
  }

  function handleSave() {
    startSave(async () => {
      const res = await saveCompanySettings(form);
      if (res.success) toast.success("会社情報を保存しました");
      else toast.error("保存に失敗しました", { description: res.error });
    });
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center h-24">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Building2 className="h-5 w-5" />
          会社情報（請求書ヘッダ）
        </CardTitle>
        <CardDescription>
          請求書・納品書に印字される自社情報です。インボイス制度の登録番号も設定してください。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>会社名 *</Label>
            <Input
              value={form.company_name ?? ""}
              onChange={(e) => set("company_name", e.target.value)}
              placeholder="小島農園"
            />
          </div>
          <div className="space-y-2">
            <Label>会社名（カナ）</Label>
            <Input
              value={form.company_name_kana ?? ""}
              onChange={(e) => set("company_name_kana", e.target.value)}
              placeholder="コジマノウエン"
            />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label>郵便番号</Label>
            <Input
              value={form.postal_code ?? ""}
              onChange={(e) => set("postal_code", e.target.value)}
              placeholder="270-0000"
            />
          </div>
          <div className="col-span-2 space-y-2">
            <Label>住所</Label>
            <Input
              value={form.address ?? ""}
              onChange={(e) => set("address", e.target.value)}
              placeholder="千葉県..."
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>電話番号</Label>
            <Input
              value={form.tel ?? ""}
              onChange={(e) => set("tel", e.target.value)}
              placeholder="047-000-0000"
            />
          </div>
          <div className="space-y-2">
            <Label>FAX</Label>
            <Input
              value={form.fax ?? ""}
              onChange={(e) => set("fax", e.target.value)}
              placeholder="047-000-0001"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label>適格請求書発行事業者登録番号</Label>
          <Input
            value={form.invoice_reg_num ?? ""}
            onChange={(e) => set("invoice_reg_num", e.target.value)}
            placeholder="T1234567890123"
            className="font-mono"
          />
          <p className="text-xs text-muted-foreground">「T」＋13桁の数字。未取得の場合は空白でも可。</p>
        </div>

        <div className="space-y-2">
          <Label>振込先情報</Label>
          <Input
            value={form.bank_info ?? ""}
            onChange={(e) => set("bank_info", e.target.value)}
            placeholder="○○銀行 △△支店 普通 1234567"
          />
        </div>

        <Separator />

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>消費税端数処理</Label>
            <select
              className="w-full h-9 rounded-md border px-3 text-sm"
              value={form.rounding_rule ?? "floor"}
              onChange={(e) => set("rounding_rule", e.target.value as CompanySettings["rounding_rule"])}
            >
              <option value="floor">切捨て</option>
              <option value="round">四捨五入</option>
              <option value="ceil">切上げ</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label>売上基準日</Label>
            <select
              className="w-full h-9 rounded-md border px-3 text-sm"
              value={form.sales_basis ?? "order_date"}
              onChange={(e) => set("sales_basis", e.target.value as CompanySettings["sales_basis"])}
            >
              <option value="order_date">受注日</option>
              <option value="delivery_date">納品日</option>
            </select>
          </div>
        </div>

        <Button onClick={handleSave} disabled={isSaving} className="w-full">
          {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
          会社情報を保存
        </Button>
      </CardContent>
    </Card>
  );
}
