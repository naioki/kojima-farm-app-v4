// @ts-nocheck — 旧スキーマ(profiles/product_standards/tenant_id)参照のため型チェック除外
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import type {
  Database,
  CustomerRow,
  ProductRow,
  ProductStandardRow,
  PriceMasterRow,
  ProfileRow,
  UnitType,
  ReceiptMode,
} from "@/lib/types/supabase";

type ActionResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string };

// ───── ヘルパー ─────────────────────────────────────────────

type AdminClientError = { error: string };
type AdminClientSuccess = {
  supabase: Awaited<ReturnType<typeof createClient>>;
  profile: ProfileRow;
  userId: string;
};

async function getAdminClient(): Promise<AdminClientError | AdminClientSuccess> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return { error: "ログインが必要です。再度ログインしてください。" };
  }
  const sb = await createServiceClient();
  const { data: profile } = await sb
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();
  if (!profile || profile.role !== "admin") {
    return { error: "この操作には管理者権限が必要です。" };
  }
  return { supabase, profile, userId: user.id };
}

// ───── 顧客 ─────────────────────────────────────────────────

export type Customer = CustomerRow;

const CustomerSchema = z.object({
  name: z.string().min(1, "顧客名を入力してください").max(100),
  store_code: z.string().max(20).nullable().optional(),
  // 中間業者名（系列）。帳票の供給先が「ヨーク 東道野辺」のように表示される。
  // 店舗指定が不要な業者（例: 寺崎）は顧客名と同じ値にすると系列名のみ表示される。
  supplier_name: z
    .string()
    .max(100)
    .transform((v) => v.trim() || null)
    .nullable()
    .optional(),
  is_active: z.boolean().default(true),
  sort_order: z.number().int().min(1).max(999).default(999).optional(),
});

export type CustomerInput = z.infer<typeof CustomerSchema>;

export async function getCustomers(): Promise<ActionResult<Customer[]>> {
  try {
    const ctx = await getAdminClient();
    if ("error" in ctx) return { success: false, error: ctx.error };
    const { supabase, profile } = ctx;

    const { data, error } = await supabase
      .from("customers")
      .select("*")
      .eq("tenant_id", profile.tenant_id)
      .order("sort_order", { ascending: true, nullsFirst: false })
      .order("name");

    if (error) {
      console.error("[getCustomers] DBエラー:", error);
      return { success: false, error: "顧客データの取得に失敗しました。" };
    }
    return { success: true, data: data ?? [] };
  } catch {
    return { success: false, error: "予期しないエラーが発生しました。" };
  }
}

export async function createCustomer(
  input: CustomerInput
): Promise<ActionResult<Customer>> {
  try {
    const parsed = CustomerSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: parsed.error.errors[0].message };
    }
    const ctx = await getAdminClient();
    if ("error" in ctx) return { success: false, error: ctx.error };
    const { supabase, profile } = ctx;

    const { data, error } = await supabase
      .from("customers")
      .insert({ ...parsed.data, tenant_id: profile.tenant_id })
      .select()
      .single();

    if (error) {
      console.error("[createCustomer] DBエラー:", error);
      if (error.code === "23505")
        return { success: false, error: "同じ顧客名がすでに登録されています。" };
      return { success: false, error: "顧客の登録に失敗しました。" };
    }

    revalidatePath("/dashboard/master");
    return { success: true, data };
  } catch {
    return { success: false, error: "予期しないエラーが発生しました。" };
  }
}

export async function updateCustomer(
  id: string,
  input: Partial<CustomerInput>
): Promise<ActionResult<Customer>> {
  try {
    const ctx = await getAdminClient();
    if ("error" in ctx) return { success: false, error: ctx.error };
    const { supabase, profile } = ctx;

    const { data, error } = await supabase
      .from("customers")
      .update(input)
      .eq("id", id)
      .eq("tenant_id", profile.tenant_id)
      .select()
      .single();

    if (error) {
      console.error("[updateCustomer] DBエラー:", error);
      if (error.code === "23505")
        return { success: false, error: "同じ顧客名がすでに登録されています。" };
      return { success: false, error: "顧客の更新に失敗しました。" };
    }

    revalidatePath("/dashboard/master");
    return { success: true, data };
  } catch {
    return { success: false, error: "予期しないエラーが発生しました。" };
  }
}

export async function deleteCustomer(id: string): Promise<ActionResult> {
  try {
    const ctx = await getAdminClient();
    if ("error" in ctx) return { success: false, error: ctx.error };
    const { supabase, profile } = ctx;

    const { error } = await supabase
      .from("customers")
      .delete()
      .eq("id", id)
      .eq("tenant_id", profile.tenant_id);

    if (error) {
      console.error("[deleteCustomer] DBエラー:", error);
      // 外部キー制約（受注に紐づく顧客は削除不可）
      if (error.code === "23503")
        return { success: false, error: "受注データに紐づいているため削除できません。" };
      return { success: false, error: "顧客の削除に失敗しました。" };
    }

    revalidatePath("/dashboard/master");
    return { success: true, data: undefined };
  } catch {
    return { success: false, error: "予期しないエラーが発生しました。" };
  }
}

// ───── 商品 ─────────────────────────────────────────────────

export type Product = ProductRow;

const ProductSchema = z.object({
  name: z.string().min(1, "商品名を入力してください").max(100),
  alt_names: z.array(z.string()).default([]),
  is_active: z.boolean().default(true),
});

export type ProductInput = z.infer<typeof ProductSchema>;

export async function getProducts(): Promise<ActionResult<Product[]>> {
  try {
    const ctx = await getAdminClient();
    if ("error" in ctx) return { success: false, error: ctx.error };
    const { supabase, profile } = ctx;

    const { data, error } = await supabase
      .from("products")
      .select("*")
      .eq("tenant_id", profile.tenant_id)
      .order("name");

    if (error) {
      console.error("[getProducts] DBエラー:", error);
      return { success: false, error: "商品データの取得に失敗しました。" };
    }
    return { success: true, data: data ?? [] };
  } catch {
    return { success: false, error: "予期しないエラーが発生しました。" };
  }
}

export async function createProduct(
  input: ProductInput
): Promise<ActionResult<Product>> {
  try {
    const parsed = ProductSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: parsed.error.errors[0].message };
    }
    const ctx = await getAdminClient();
    if ("error" in ctx) return { success: false, error: ctx.error };
    const { supabase, profile } = ctx;

    const { data, error } = await supabase
      .from("products")
      .insert({ ...parsed.data, tenant_id: profile.tenant_id })
      .select()
      .single();

    if (error) {
      console.error("[createProduct] DBエラー:", error);
      if (error.code === "23505")
        return { success: false, error: "同じ商品名がすでに登録されています。" };
      return { success: false, error: "商品の登録に失敗しました。" };
    }

    revalidatePath("/dashboard/master");
    return { success: true, data };
  } catch {
    return { success: false, error: "予期しないエラーが発生しました。" };
  }
}

export async function updateProduct(
  id: string,
  input: Partial<ProductInput>
): Promise<ActionResult<Product>> {
  try {
    const ctx = await getAdminClient();
    if ("error" in ctx) return { success: false, error: ctx.error };
    const { supabase, profile } = ctx;

    const { data, error } = await supabase
      .from("products")
      .update(input)
      .eq("id", id)
      .eq("tenant_id", profile.tenant_id)
      .select()
      .single();

    if (error) {
      console.error("[updateProduct] DBエラー:", error);
      if (error.code === "23505")
        return { success: false, error: "同じ商品名がすでに登録されています。" };
      return { success: false, error: "商品の更新に失敗しました。" };
    }

    revalidatePath("/dashboard/master");
    return { success: true, data };
  } catch {
    return { success: false, error: "予期しないエラーが発生しました。" };
  }
}

export async function deleteProduct(id: string): Promise<ActionResult> {
  try {
    const ctx = await getAdminClient();
    if ("error" in ctx) return { success: false, error: ctx.error };
    const { supabase, profile } = ctx;

    const { error } = await supabase
      .from("products")
      .delete()
      .eq("id", id)
      .eq("tenant_id", profile.tenant_id);

    if (error) {
      console.error("[deleteProduct] DBエラー:", error);
      // on delete restrict: 規格に紐づく商品は削除不可
      if (error.code === "23503")
        return { success: false, error: "規格データに紐づいているため削除できません。" };
      return { success: false, error: "商品の削除に失敗しました。" };
    }

    revalidatePath("/dashboard/master");
    return { success: true, data: undefined };
  } catch {
    return { success: false, error: "予期しないエラーが発生しました。" };
  }
}

// ───── 商品規格 ─────────────────────────────────────────────

export type ProductStandard = ProductStandardRow;

// UnitType / ReceiptMode の Zod バリデーション
const UNIT_TYPES: [UnitType, ...UnitType[]] = ['袋', '本', '箱', '束', 'kg', '個'];
const RECEIPT_MODES: [ReceiptMode, ...ReceiptMode[]] = ['box_count', 'total_count'];

const ProductStandardSchema = z.object({
  product_id: z.string().uuid("商品IDの形式が正しくありません"),
  name: z.string().min(1, "規格名を入力してください").max(100),
  unit_size: z
    .number({ invalid_type_error: "入数は数値で入力してください" })
    .int()
    .min(1, "入数は1以上を入力してください"),
  unit_type: z.enum(UNIT_TYPES, { errorMap: () => ({ message: "単位を選択してください" }) }),
  receipt_mode: z.enum(RECEIPT_MODES).default("total_count"),
  is_active: z.boolean().default(true),
});

export type ProductStandardInput = z.infer<typeof ProductStandardSchema>;

export async function getProductStandards(
  productId?: string
): Promise<ActionResult<ProductStandard[]>> {
  try {
    const ctx = await getAdminClient();
    if ("error" in ctx) return { success: false, error: ctx.error };
    const { supabase, profile } = ctx;

    let query = supabase
      .from("product_standards")
      .select("*")
      .eq("tenant_id", profile.tenant_id)
      .order("name");

    if (productId) query = query.eq("product_id", productId);

    const { data, error } = await query;

    if (error) {
      console.error("[getProductStandards] DBエラー:", error);
      return { success: false, error: "規格データの取得に失敗しました。" };
    }
    return { success: true, data: data ?? [] };
  } catch {
    return { success: false, error: "予期しないエラーが発生しました。" };
  }
}

export async function createProductStandard(
  input: ProductStandardInput
): Promise<ActionResult<ProductStandard>> {
  try {
    const parsed = ProductStandardSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: parsed.error.errors[0].message };
    }
    const ctx = await getAdminClient();
    if ("error" in ctx) return { success: false, error: ctx.error };
    const { supabase, profile } = ctx;

    const { data, error } = await supabase
      .from("product_standards")
      .insert({ ...parsed.data, tenant_id: profile.tenant_id })
      .select()
      .single();

    if (error) {
      console.error("[createProductStandard] DBエラー:", error);
      if (error.code === "23505")
        return { success: false, error: "同じ規格名がすでに登録されています。" };
      return { success: false, error: "規格の登録に失敗しました。" };
    }

    revalidatePath("/dashboard/master");
    return { success: true, data };
  } catch {
    return { success: false, error: "予期しないエラーが発生しました。" };
  }
}

export async function updateProductStandard(
  id: string,
  input: Partial<ProductStandardInput>
): Promise<ActionResult<ProductStandard>> {
  try {
    const ctx = await getAdminClient();
    if ("error" in ctx) return { success: false, error: ctx.error };
    const { supabase, profile } = ctx;

    const { data, error } = await supabase
      .from("product_standards")
      .update(input)
      .eq("id", id)
      .eq("tenant_id", profile.tenant_id)
      .select()
      .single();

    if (error) {
      console.error("[updateProductStandard] DBエラー:", error);
      if (error.code === "23505")
        return { success: false, error: "同じ規格名がすでに登録されています。" };
      return { success: false, error: "規格の更新に失敗しました。" };
    }

    revalidatePath("/dashboard/master");
    return { success: true, data };
  } catch {
    return { success: false, error: "予期しないエラーが発生しました。" };
  }
}

export async function deleteProductStandard(id: string): Promise<ActionResult> {
  try {
    const ctx = await getAdminClient();
    if ("error" in ctx) return { success: false, error: ctx.error };
    const { supabase, profile } = ctx;

    const { error } = await supabase
      .from("product_standards")
      .delete()
      .eq("id", id)
      .eq("tenant_id", profile.tenant_id);

    if (error) {
      console.error("[deleteProductStandard] DBエラー:", error);
      // on delete restrict: 受注明細・価格マスタに紐づく規格は削除不可
      if (error.code === "23503")
        return { success: false, error: "受注または価格マスタに紐づいているため削除できません。" };
      return { success: false, error: "規格の削除に失敗しました。" };
    }

    revalidatePath("/dashboard/master");
    return { success: true, data: undefined };
  } catch {
    return { success: false, error: "予期しないエラーが発生しました。" };
  }
}

// ───── 価格マスタ ────────────────────────────────────────────

export type PriceMaster = PriceMasterRow;

const PriceMasterSchema = z.object({
  customer_id: z.string().uuid("顧客IDの形式が正しくありません"),
  product_standard_id: z.string().uuid("規格IDの形式が正しくありません"),
  unit_price: z
    .number({ invalid_type_error: "単価は数値で入力してください" })
    .min(0, "単価は0以上を入力してください"),
  valid_from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "日付はYYYY-MM-DD形式で入力してください"),
  valid_to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "日付はYYYY-MM-DD形式で入力してください")
    .nullable()
    .optional(),
});

export type PriceMasterInput = z.infer<typeof PriceMasterSchema>;

export async function getPriceMaster(): Promise<ActionResult<PriceMaster[]>> {
  try {
    const ctx = await getAdminClient();
    if ("error" in ctx) return { success: false, error: ctx.error };
    const { supabase, profile } = ctx;

    const { data, error } = await supabase
      .from("price_master")
      .select("*")
      .eq("tenant_id", profile.tenant_id)
      .order("valid_from", { ascending: false });

    if (error) {
      console.error("[getPriceMaster] DBエラー:", error);
      return { success: false, error: "価格マスタの取得に失敗しました。" };
    }
    return { success: true, data: data ?? [] };
  } catch {
    return { success: false, error: "予期しないエラーが発生しました。" };
  }
}

export async function createPriceMaster(
  input: PriceMasterInput
): Promise<ActionResult<PriceMaster>> {
  try {
    const parsed = PriceMasterSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: parsed.error.errors[0].message };
    }
    const ctx = await getAdminClient();
    if ("error" in ctx) return { success: false, error: ctx.error };
    const { supabase, profile, userId } = ctx;

    const { data, error } = await supabase
      .from("price_master")
      .insert({
        ...parsed.data,
        tenant_id: profile.tenant_id,
        created_by: userId,
      })
      .select()
      .single();

    if (error) {
      console.error("[createPriceMaster] DBエラー:", error);
      // 同一顧客×規格の active 価格が既に存在（部分ユニーク制約）
      if (error.code === "23505")
        return {
          success: false,
          error: "この顧客×規格の有効な価格がすでに存在します。既存価格に終了日を設定してから登録してください。",
        };
      return { success: false, error: "価格の登録に失敗しました。" };
    }

    revalidatePath("/dashboard/master");
    return { success: true, data };
  } catch {
    return { success: false, error: "予期しないエラーが発生しました。" };
  }
}

export async function closePriceMaster(
  id: string,
  validTo: string
): Promise<ActionResult<PriceMaster>> {
  try {
    const dateSchema = z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "日付はYYYY-MM-DD形式で入力してください");
    const dateParse = dateSchema.safeParse(validTo);
    if (!dateParse.success) {
      return { success: false, error: dateParse.error.errors[0].message };
    }

    const ctx = await getAdminClient();
    if ("error" in ctx) return { success: false, error: ctx.error };
    const { supabase, profile } = ctx;

    const { data, error } = await supabase
      .from("price_master")
      .update({ valid_to: validTo })
      .eq("id", id)
      .eq("tenant_id", profile.tenant_id)
      .select()
      .single();

    if (error) {
      console.error("[closePriceMaster] DBエラー:", error);
      return { success: false, error: "価格終了日の設定に失敗しました。" };
    }

    revalidatePath("/dashboard/master");
    return { success: true, data };
  } catch {
    return { success: false, error: "予期しないエラーが発生しました。" };
  }
}

export async function deletePriceMaster(id: string): Promise<ActionResult> {
  try {
    const ctx = await getAdminClient();
    if ("error" in ctx) return { success: false, error: ctx.error };
    const { supabase, profile } = ctx;

    const { error } = await supabase
      .from("price_master")
      .delete()
      .eq("id", id)
      .eq("tenant_id", profile.tenant_id);

    if (error) {
      console.error("[deletePriceMaster] DBエラー:", error);
      return { success: false, error: "価格の削除に失敗しました。" };
    }

    revalidatePath("/dashboard/master");
    return { success: true, data: undefined };
  } catch {
    return { success: false, error: "予期しないエラーが発生しました。" };
  }
}

// ───── 品目マスタ（products + product_standards の結合ビュー）────────

export type ItemMasterRow = {
  standard_id: string;
  product_id: string;
  item_name: string;
  spec_name: string;
  alt_names_str: string;
  unit_size: number;
  unit_type: string;
  receipt_mode: string;
};

export async function getItemMaster(): Promise<ActionResult<ItemMasterRow[]>> {
  try {
    const ctx = await getAdminClient();
    if ("error" in ctx) return { success: false, error: ctx.error };
    const { supabase, profile } = ctx;

    const { data: standards, error } = await supabase
      .from("product_standards")
      .select("id, product_id, name, unit_size, unit_type, receipt_mode, products(name, alt_names)")
      .eq("tenant_id", profile.tenant_id)
      .eq("is_active", true)
      .order("name");

    if (error) {
      console.error("[getItemMaster] DBエラー:", error);
      return { success: false, error: "品目マスタの取得に失敗しました。" };
    }

    const rows: ItemMasterRow[] = (standards ?? []).map((s: any) => ({
      standard_id: s.id,
      product_id: s.product_id,
      item_name: s.products?.name ?? "",
      spec_name: s.name,
      alt_names_str: (s.products?.alt_names ?? []).join(", "),
      unit_size: s.unit_size,
      unit_type: s.unit_type,
      receipt_mode: s.receipt_mode,
    }));

    return { success: true, data: rows };
  } catch {
    return { success: false, error: "予期しないエラーが発生しました。" };
  }
}

export type SaveItemRowInput = {
  standard_id: string | null;
  product_id: string | null;
  item_name: string;
  spec_name: string;
  alt_names_str: string;
  unit_size: number;
  unit_type: string;
  receipt_mode: string;
};

export async function saveItemMasterRow(
  input: SaveItemRowInput
): Promise<ActionResult<ItemMasterRow>> {
  try {
    const ctx = await getAdminClient();
    if ("error" in ctx) return { success: false, error: ctx.error };
    const { supabase, profile } = ctx;

    const altNames = input.alt_names_str
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    let productId = input.product_id;

    if (!productId) {
      // 同名 product が存在すれば再利用
      const { data: existing } = await supabase
        .from("products")
        .select("id")
        .eq("tenant_id", profile.tenant_id)
        .eq("name", input.item_name)
        .single();

      if (existing) {
        productId = existing.id;
      } else {
        const { data: newProd, error: prodErr } = await supabase
          .from("products")
          .insert({ name: input.item_name, alt_names: altNames, tenant_id: profile.tenant_id, is_active: true })
          .select("id")
          .single();
        if (prodErr) {
          if (prodErr.code === "23505")
            return { success: false, error: `品目名「${input.item_name}」は既に登録されています。規格を追加する場合は既存の品目を編集してください。` };
          return { success: false, error: "品目の登録に失敗しました。" };
        }
        productId = newProd.id;
      }
    } else {
      // product の name / alt_names を更新（同名の別品目があると一意制約で弾かれる）
      const { error: updErr } = await supabase
        .from("products")
        .update({ name: input.item_name, alt_names: altNames })
        .eq("id", productId)
        .eq("tenant_id", profile.tenant_id);
      if (updErr) {
        if (updErr.code === "23505")
          return { success: false, error: `品目名「${input.item_name}」は既に別の品目として登録されています。同じ品目名は使えません（規格で区別してください）。` };
        return { success: false, error: "品目の更新に失敗しました。" };
      }
    }

    let standardId = input.standard_id;
    if (!standardId) {
      // 新規 standard 作成
      const { data: newStd, error: stdErr } = await supabase
        .from("product_standards")
        .insert({
          product_id: productId!,
          name: input.spec_name,
          unit_size: input.unit_size,
          unit_type: input.unit_type as any,
          receipt_mode: input.receipt_mode as any,
          tenant_id: profile.tenant_id,
          is_active: true,
        })
        .select("id")
        .single();
      if (stdErr) return { success: false, error: "規格の登録に失敗しました。" };
      standardId = newStd.id;
    } else {
      await supabase
        .from("product_standards")
        .update({
          product_id: productId!,
          name: input.spec_name,
          unit_size: input.unit_size,
          unit_type: input.unit_type as any,
          receipt_mode: input.receipt_mode as any,
        })
        .eq("id", standardId)
        .eq("tenant_id", profile.tenant_id);
    }

    revalidatePath("/dashboard/master");
    return {
      success: true,
      data: {
        standard_id: standardId!,
        product_id: productId!,
        item_name: input.item_name,
        spec_name: input.spec_name,
        alt_names_str: altNames.join(", "),
        unit_size: input.unit_size,
        unit_type: input.unit_type,
        receipt_mode: input.receipt_mode,
      },
    };
  } catch {
    return { success: false, error: "予期しないエラーが発生しました。" };
  }
}

export async function deleteItemMasterRow(standard_id: string): Promise<ActionResult> {
  try {
    const ctx = await getAdminClient();
    if ("error" in ctx) return { success: false, error: ctx.error };
    const { supabase, profile } = ctx;

    const { error } = await supabase
      .from("product_standards")
      .update({ is_active: false })
      .eq("id", standard_id)
      .eq("tenant_id", profile.tenant_id);

    if (error) return { success: false, error: "削除に失敗しました。" };

    revalidatePath("/dashboard/master");
    return { success: true, data: undefined };
  } catch {
    return { success: false, error: "予期しないエラーが発生しました。" };
  }
}
