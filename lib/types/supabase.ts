// 本番環境では以下で自動生成して置き換えること:
// npx supabase gen types typescript --project-id <project_id> > lib/types/supabase.ts

// ── JSON 型 ──────────────────────────────────────────────────
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

// ── Enum 型 ──────────────────────────────────────────────────
export type UserRole = 'admin' | 'field_worker' | 'viewer'
export type UnitType = '袋' | '本' | '箱' | '束' | 'kg' | '個'
export type ReceiptMode = 'box_count' | 'total_count'
export type OrderSource = 'ocr' | 'manual' | 'email' | 'sheets_sync'
export type OrderStatus = 'pending' | 'verified' | 'shipped' | 'cancelled'
export type OcrStatus = 'pending' | 'auto_accepted' | 'needs_review' | 'corrected' | 'rejected'

// ── Supabase 内部型（GenericRelationship 互換） ───────────────
type Relationship = {
  foreignKeyName: string
  columns: string[]
  isOneToOne?: boolean
  referencedRelation: string
  referencedColumns: string[]
}

// ── Database 型 ───────────────────────────────────────────────
export type Database = {
  public: {
    Tables: {
      // テナント
      tenants: {
        Row: {
          id: string
          name: string
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          created_at?: string
        }
        Relationships: []
      }

      // プロファイル
      profiles: {
        Row: {
          id: string
          tenant_id: string
          role: UserRole
          display_name: string | null
          created_at: string
        }
        Insert: {
          id: string
          tenant_id: string
          role?: UserRole
          display_name?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          tenant_id?: string
          role?: UserRole
          display_name?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'profiles_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          }
        ]
      }

      // 商品
      products: {
        Row: {
          id: string
          tenant_id: string
          name: string
          alt_names: string[]
          is_active: boolean
          created_at: string
        }
        Insert: {
          id?: string
          tenant_id: string
          name: string
          alt_names?: string[]
          is_active?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          tenant_id?: string
          name?: string
          alt_names?: string[]
          is_active?: boolean
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'products_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          }
        ]
      }

      // 商品規格
      product_standards: {
        Row: {
          id: string
          tenant_id: string
          product_id: string
          name: string
          unit_size: number
          unit_type: UnitType
          receipt_mode: ReceiptMode
          is_active: boolean
          created_at: string
        }
        Insert: {
          id?: string
          tenant_id: string
          product_id: string
          name: string
          unit_size: number
          unit_type: UnitType
          receipt_mode?: ReceiptMode
          is_active?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          tenant_id?: string
          product_id?: string
          name?: string
          unit_size?: number
          unit_type?: UnitType
          receipt_mode?: ReceiptMode
          is_active?: boolean
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'product_standards_product_id_fkey'
            columns: ['product_id']
            isOneToOne: false
            referencedRelation: 'products'
            referencedColumns: ['id']
          }
        ]
      }

      // 顧客
      customers: {
        Row: {
          id: string
          tenant_id: string
          name: string
          store_code: string | null
          is_active: boolean
          created_at: string
        }
        Insert: {
          id?: string
          tenant_id: string
          name: string
          store_code?: string | null
          is_active?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          tenant_id?: string
          name?: string
          store_code?: string | null
          is_active?: boolean
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'customers_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          }
        ]
      }

      // 単価マスタ（numeric → number, date → string）
      price_master: {
        Row: {
          id: string
          tenant_id: string
          customer_id: string
          product_standard_id: string
          unit_price: number            // numeric(10,2)
          valid_from: string            // date → YYYY-MM-DD
          valid_to: string | null       // date | null
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          tenant_id: string
          customer_id: string
          product_standard_id: string
          unit_price: number
          valid_from?: string
          valid_to?: string | null
          created_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          tenant_id?: string
          customer_id?: string
          product_standard_id?: string
          unit_price?: number
          valid_from?: string
          valid_to?: string | null
          created_by?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'price_master_customer_id_fkey'
            columns: ['customer_id']
            isOneToOne: false
            referencedRelation: 'customers'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'price_master_product_standard_id_fkey'
            columns: ['product_standard_id']
            isOneToOne: false
            referencedRelation: 'product_standards'
            referencedColumns: ['id']
          }
        ]
      }

      // 受注
      orders: {
        Row: {
          id: string
          tenant_id: string
          order_date: string            // date → YYYY-MM-DD
          source: OrderSource
          status: OrderStatus
          notes: string | null
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          tenant_id: string
          order_date?: string
          source: OrderSource
          status?: OrderStatus
          notes?: string | null
          created_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          tenant_id?: string
          order_date?: string
          source?: OrderSource
          status?: OrderStatus
          notes?: string | null
          created_by?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'orders_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          }
        ]
      }

      // 受注明細
      order_lines: {
        Row: {
          id: string
          tenant_id: string
          order_id: string
          customer_id: string
          product_standard_id: string
          boxes: number
          remainder: number
          total_qty: number
          unit_price: number | null     // numeric(10,2)
          line_total: number | null     // numeric(10,2)
          created_at: string
        }
        Insert: {
          id?: string
          tenant_id: string
          order_id: string
          customer_id: string
          product_standard_id: string
          boxes?: number
          remainder?: number
          total_qty: number
          unit_price?: number | null
          line_total?: number | null
          created_at?: string
        }
        Update: {
          id?: string
          tenant_id?: string
          order_id?: string
          customer_id?: string
          product_standard_id?: string
          boxes?: number
          remainder?: number
          total_qty?: number
          unit_price?: number | null
          line_total?: number | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'order_lines_order_id_fkey'
            columns: ['order_id']
            isOneToOne: false
            referencedRelation: 'orders'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'order_lines_customer_id_fkey'
            columns: ['customer_id']
            isOneToOne: false
            referencedRelation: 'customers'
            referencedColumns: ['id']
          }
        ]
      }

      // OCR 検証
      ocr_verifications: {
        Row: {
          id: string
          tenant_id: string
          order_id: string | null
          image_url: string
          raw_ocr_json: Json
          parsed_lines: Json            // ParsedOcrLine[] として扱う
          confidence_flags: Json
          status: OcrStatus
          reviewed_by: string | null
          reviewed_at: string | null
          correction_notes: string | null
          created_at: string
        }
        Insert: {
          id?: string
          tenant_id: string
          order_id?: string | null
          image_url: string
          raw_ocr_json: Json
          parsed_lines?: Json
          confidence_flags?: Json
          status?: OcrStatus
          reviewed_by?: string | null
          reviewed_at?: string | null
          correction_notes?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          tenant_id?: string
          order_id?: string | null
          image_url?: string
          raw_ocr_json?: Json
          parsed_lines?: Json
          confidence_flags?: Json
          status?: OcrStatus
          reviewed_by?: string | null
          reviewed_at?: string | null
          correction_notes?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'ocr_verifications_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'ocr_verifications_reviewed_by_fkey'
            columns: ['reviewed_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'ocr_verifications_order_id_fkey'
            columns: ['order_id']
            isOneToOne: false
            referencedRelation: 'orders'
            referencedColumns: ['id']
          }
        ]
      }

      // 監査ログ（id は bigint generated always → 挿入不可）
      audit_logs: {
        Row: {
          id: number
          tenant_id: string
          table_name: string
          record_id: string
          operation: string
          old_values: Json | null
          new_values: Json | null
          changed_by: string | null
          changed_at: string
        }
        Insert: never                   // generated always as identity のため挿入不可
        Update: never
        Relationships: []
      }
    }

    Views: {
      [_ in never]: never
    }

    Functions: {
      // OCR 承認 RPC（service_role のみ実行可）
      approve_ocr_verification: {
        Args: {
          p_verification_id: string
          p_tenant_id: string
          p_reviewed_by: string
          p_order_date: string          // date 型：YYYY-MM-DD
          p_correction_notes: string | null
          p_lines: Json                 // CorrectedLine[] を JSON として渡す
        }
        Returns: string                 // 作成された order.id (uuid)
      }
      // 認証ユーザーのテナント ID を返すヘルパー
      current_tenant_id: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
    }

    Enums: {
      user_role: UserRole
      unit_type: UnitType
      receipt_mode: ReceiptMode
      order_source: OrderSource
      order_status: OrderStatus
      ocr_status: OcrStatus
    }

    CompositeTypes: {
      [_ in never]: never
    }
  }
}

// ── 便利な Row 型ショートカット ────────────────────────────────
type Tables = Database['public']['Tables']
export type TenantRow          = Tables['tenants']['Row']
export type ProfileRow         = Tables['profiles']['Row']
export type ProductRow         = Tables['products']['Row']
export type ProductStandardRow = Tables['product_standards']['Row']
export type CustomerRow        = Tables['customers']['Row']
export type PriceMasterRow     = Tables['price_master']['Row']
export type OrderRow           = Tables['orders']['Row']
export type OrderLineRow       = Tables['order_lines']['Row']
export type OcrVerificationRow = Tables['ocr_verifications']['Row']
export type AuditLogRow        = Tables['audit_logs']['Row']
