import { z } from 'zod'

// ── 人間可読フォーム用スキーマ（UUID ではなく名前で入力）────────────────
// FastAPI の POST /api/ocr/verify が store/item → UUID を解決する

export const HumanLineSchema = z.object({
  store: z
    .string()
    .min(1, { message: '店舗名は必須です' })
    .max(100),
  item: z
    .string()
    .min(1, { message: '品目名は必須です' })
    .max(100),
  spec: z.string().max(100).default(''),
  unit: z
    .number({ invalid_type_error: '入数は数値で入力してください' })
    .int()
    .min(0)
    .default(0),
  boxes: z
    .number({ invalid_type_error: '箱数は数値で入力してください' })
    .int({ message: '箱数は整数で入力してください' })
    .min(0, { message: '箱数は0以上を入力してください' })
    .default(0),
  remainder: z
    .number({ invalid_type_error: 'バラ数は数値で入力してください' })
    .int({ message: 'バラ数は整数で入力してください' })
    .min(0, { message: 'バラ数は0以上を入力してください' })
    .default(0),
})

export const HumanFormSchema = z.object({
  order_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, { message: '日付は YYYY-MM-DD 形式で入力してください' }),
  lines: z
    .array(HumanLineSchema)
    .min(1, { message: '明細は1件以上必要です' })
    .max(50, { message: '1回の承認で登録できる明細は50件までです' }),
  correction_notes: z
    .string()
    .max(1000, { message: '修正メモは1000文字以内で入力してください' })
    .optional(),
})

export type HumanLine = z.infer<typeof HumanLineSchema>
export type HumanForm = z.infer<typeof HumanFormSchema>

// ── 後方互換: Supabase RPC 直呼び用（UUID ベース）────────────────────────
export const CorrectedLineSchema = z.object({
  customer_id: z.string().uuid({ message: '顧客IDの形式が正しくありません' }),
  product_standard_id: z.string().uuid({ message: '規格IDの形式が正しくありません' }),
  boxes: z.number().int().min(0),
  remainder: z.number().int().min(0),
  total_qty: z.number().int().min(1),
  notes: z.string().max(500).optional(),
})

export const CorrectedDataSchema = z.object({
  order_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  lines: z.array(CorrectedLineSchema).min(1).max(50),
  correction_notes: z.string().max(1000).optional(),
})

export type CorrectedData = z.infer<typeof CorrectedDataSchema>
export type CorrectedLine = z.infer<typeof CorrectedLineSchema>
