// 自動生成 (supabase gen types typescript --project-id ggenmkcdwzpydbkpxpms)

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      app_settings: {
        Row: {
          is_secret: boolean
          key: string
          updated_at: string
          updated_by: string | null
          value: string | null
        }
        Insert: {
          is_secret?: boolean
          key: string
          updated_at?: string
          updated_by?: string | null
          value?: string | null
        }
        Update: {
          is_secret?: boolean
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "app_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          changed_fields: string[] | null
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          new_values: Json | null
          old_values: Json | null
          user_id: string | null
        }
        Insert: {
          action: string
          changed_fields?: string[] | null
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          new_values?: Json | null
          old_values?: Json | null
          user_id?: string | null
        }
        Update: {
          action?: string
          changed_fields?: string[] | null
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          new_values?: Json | null
          old_values?: Json | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      company_settings: {
        Row: {
          address: string | null
          bank_info: string | null
          company_name: string
          company_name_kana: string | null
          created_at: string
          email: string | null
          fax: string | null
          id: string
          invoice_reg_num: string | null
          postal_code: string | null
          rounding_rule: string
          sales_basis: string
          tel: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          bank_info?: string | null
          company_name?: string
          company_name_kana?: string | null
          created_at?: string
          email?: string | null
          fax?: string | null
          id?: string
          invoice_reg_num?: string | null
          postal_code?: string | null
          rounding_rule?: string
          sales_basis?: string
          tel?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          bank_info?: string | null
          company_name?: string
          company_name_kana?: string | null
          created_at?: string
          email?: string | null
          fax?: string | null
          id?: string
          invoice_reg_num?: string | null
          postal_code?: string | null
          rounding_rule?: string
          sales_basis?: string
          tel?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      customer_parse_hints: {
        Row: {
          corrected_name: string | null
          created_at: string
          created_by: string | null
          customer_id: string
          hit_count: number
          id: string
          note: string | null
          product_id: string | null
          raw_name: string
          updated_at: string
        }
        Insert: {
          corrected_name?: string | null
          created_at?: string
          created_by?: string | null
          customer_id: string
          hit_count?: number
          id?: string
          note?: string | null
          product_id?: string | null
          raw_name: string
          updated_at?: string
        }
        Update: {
          corrected_name?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string
          hit_count?: number
          id?: string
          note?: string | null
          product_id?: string | null
          raw_name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_parse_hints_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_parse_hints_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_parse_hints_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_product_rules: {
        Row: {
          container_type: string | null
          created_at: string | null
          customer_id: string
          default_quantity: number | null
          fraction_policy: string | null
          has_card: boolean
          id: string
          is_default_set: boolean | null
          label_spec: string | null
          packing_notes: string | null
          packs_per_case: number | null
          product_id: string
          spec: string | null
          tape_color: string | null
        }
        Insert: {
          container_type?: string | null
          created_at?: string | null
          customer_id: string
          default_quantity?: number | null
          fraction_policy?: string | null
          has_card?: boolean
          id?: string
          is_default_set?: boolean | null
          label_spec?: string | null
          packing_notes?: string | null
          packs_per_case?: number | null
          product_id: string
          spec?: string | null
          tape_color?: string | null
        }
        Update: {
          container_type?: string | null
          created_at?: string | null
          customer_id?: string
          default_quantity?: number | null
          fraction_policy?: string | null
          has_card?: boolean
          id?: string
          is_default_set?: boolean | null
          label_spec?: string | null
          packing_notes?: string | null
          packs_per_case?: number | null
          product_id?: string
          spec?: string | null
          tape_color?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_product_rules_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_product_rules_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          channel_identifiers: Json
          closing_rule: string
          created_at: string
          display_color: string | null
          id: string
          invoice_reg_num: string | null
          is_active: boolean
          name: string
          name_kana: string | null
          payment_terms: string | null
          updated_at: string
        }
        Insert: {
          channel_identifiers?: Json
          closing_rule?: string
          created_at?: string
          display_color?: string | null
          id?: string
          invoice_reg_num?: string | null
          is_active?: boolean
          name: string
          name_kana?: string | null
          payment_terms?: string | null
          updated_at?: string
        }
        Update: {
          channel_identifiers?: Json
          closing_rule?: string
          created_at?: string
          display_color?: string | null
          id?: string
          invoice_reg_num?: string | null
          is_active?: boolean
          name?: string
          name_kana?: string | null
          payment_terms?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      delivery_destinations: {
        Row: {
          aliases: string[]
          code: string | null
          created_at: string
          customer_id: string
          full_name: string
          id: string
          is_active: boolean
          sort_order: number
          updated_at: string
        }
        Insert: {
          aliases?: string[]
          code?: string | null
          created_at?: string
          customer_id: string
          full_name: string
          id?: string
          is_active?: boolean
          sort_order?: number
          updated_at?: string
        }
        Update: {
          aliases?: string[]
          code?: string | null
          created_at?: string
          customer_id?: string
          full_name?: string
          id?: string
          is_active?: boolean
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "delivery_destinations_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_note_counters: {
        Row: { last_seq: number; month: string }
        Insert: { last_seq?: number; month: string }
        Update: { last_seq?: number; month?: string }
        Relationships: []
      }
      delivery_note_items: {
        Row: {
          created_at: string
          delivery_note_id: string
          id: string
          product_name: string
          quantity: number
          sort_order: number
          subtotal: number
          tax_rate: number
          unit: string
          unit_price: number
        }
        Insert: {
          created_at?: string
          delivery_note_id: string
          id?: string
          product_name: string
          quantity: number
          sort_order?: number
          subtotal?: number
          tax_rate: number
          unit?: string
          unit_price?: number
        }
        Update: {
          created_at?: string
          delivery_note_id?: string
          id?: string
          product_name?: string
          quantity?: number
          sort_order?: number
          subtotal?: number
          tax_rate?: number
          unit?: string
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "delivery_note_items_delivery_note_id_fkey"
            columns: ["delivery_note_id"]
            isOneToOne: false
            referencedRelation: "delivery_notes"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_notes: {
        Row: {
          amount_mode: string
          created_at: string
          customer_id: string
          customer_name: string
          delivery_date: string
          id: string
          issued_at: string
          issued_by: string | null
          issuer_address: string | null
          issuer_name: string | null
          issuer_tel: string | null
          note_number: string
          subtotal_10: number
          subtotal_8: number
          total_amount: number
        }
        Insert: {
          amount_mode?: string
          created_at?: string
          customer_id: string
          customer_name: string
          delivery_date: string
          id?: string
          issued_at?: string
          issued_by?: string | null
          issuer_address?: string | null
          issuer_name?: string | null
          issuer_tel?: string | null
          note_number: string
          subtotal_10?: number
          subtotal_8?: number
          total_amount?: number
        }
        Update: {
          amount_mode?: string
          created_at?: string
          customer_id?: string
          customer_name?: string
          delivery_date?: string
          id?: string
          issued_at?: string
          issued_by?: string | null
          issuer_address?: string | null
          issuer_name?: string | null
          issuer_tel?: string | null
          note_number?: string
          subtotal_10?: number
          subtotal_8?: number
          total_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "delivery_notes_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_notes_issued_by_fkey"
            columns: ["issued_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      gemini_usage_log: {
        Row: {
          called_at: string | null
          channel: string | null
          id: string
          mode: string | null
          success: boolean | null
          tokens_used: number | null
        }
        Insert: {
          called_at?: string | null
          channel?: string | null
          id?: string
          mode?: string | null
          success?: boolean | null
          tokens_used?: number | null
        }
        Update: {
          called_at?: string | null
          channel?: string | null
          id?: string
          mode?: string | null
          success?: boolean | null
          tokens_used?: number | null
        }
        Relationships: []
      }
      harvest_estimates: {
        Row: {
          actual_qty: number | null
          adjustment_memo: string | null
          carry_over: number | null
          created_by: string | null
          estimate_date: string
          estimate_qty: number | null
          id: string
          planned_qty: number | null
          product_id: string
          status: string
          updated_at: string | null
        }
        Insert: {
          actual_qty?: number | null
          adjustment_memo?: string | null
          carry_over?: number | null
          created_by?: string | null
          estimate_date: string
          estimate_qty?: number | null
          id?: string
          planned_qty?: number | null
          product_id: string
          status?: string
          updated_at?: string | null
        }
        Update: {
          actual_qty?: number | null
          adjustment_memo?: string | null
          carry_over?: number | null
          created_by?: string | null
          estimate_date?: string
          estimate_qty?: number | null
          id?: string
          planned_qty?: number | null
          product_id?: string
          status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "harvest_estimates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "harvest_estimates_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      harvest_tasks: {
        Row: {
          assigned_to: string | null
          created_at: string
          id: string
          order_item_id: string | null
          product_id: string
          required_qty: number
          status: string
          task_date: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          created_at?: string
          id?: string
          order_item_id?: string | null
          product_id: string
          required_qty?: number
          status?: string
          task_date: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          created_at?: string
          id?: string
          order_item_id?: string | null
          product_id?: string
          required_qty?: number
          status?: string
          task_date?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "harvest_tasks_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "harvest_tasks_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "harvest_tasks_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_counters: {
        Row: { last_seq: number; month: string }
        Insert: { last_seq?: number; month: string }
        Update: { last_seq?: number; month?: string }
        Relationships: []
      }
      invoice_items: {
        Row: {
          created_at: string
          id: string
          invoice_id: string
          line_total: number | null
          order_item_id: string | null
          product_name: string
          quantity: number
          subtotal: number | null
          tax_amount: number | null
          tax_rate: number
          unit: string
          unit_price: number
        }
        Insert: {
          created_at?: string
          id?: string
          invoice_id: string
          line_total?: number | null
          order_item_id?: string | null
          product_name: string
          quantity: number
          subtotal?: number | null
          tax_amount?: number | null
          tax_rate: number
          unit?: string
          unit_price: number
        }
        Update: {
          created_at?: string
          id?: string
          invoice_id?: string
          line_total?: number | null
          order_item_id?: string | null
          product_name?: string
          quantity?: number
          subtotal?: number | null
          tax_amount?: number | null
          tax_rate?: number
          unit?: string
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          billing_month: string
          created_at: string
          created_by: string | null
          customer_id: string
          due_date: string | null
          id: string
          invoice_number: string
          invoice_reg_num: string | null
          issue_date: string | null
          pdf_r2_key: string | null
          period_end: string | null
          period_start: string | null
          status: string
          subtotal_10: number
          subtotal_8: number
          tax_10: number
          tax_8: number
          total_amount: number
          updated_at: string
        }
        Insert: {
          billing_month: string
          created_at?: string
          created_by?: string | null
          customer_id: string
          due_date?: string | null
          id?: string
          invoice_number: string
          invoice_reg_num?: string | null
          issue_date?: string | null
          pdf_r2_key?: string | null
          period_end?: string | null
          period_start?: string | null
          status?: string
          subtotal_10?: number
          subtotal_8?: number
          tax_10?: number
          tax_8?: number
          total_amount?: number
          updated_at?: string
        }
        Update: {
          billing_month?: string
          created_at?: string
          created_by?: string | null
          customer_id?: string
          due_date?: string | null
          id?: string
          invoice_number?: string
          invoice_reg_num?: string | null
          issue_date?: string | null
          pdf_r2_key?: string | null
          period_end?: string | null
          period_start?: string | null
          status?: string
          subtotal_10?: number
          subtotal_8?: number
          tax_10?: number
          tax_8?: number
          total_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoices_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          billable_qty: number | null
          billable_reason: string | null
          confidence: number | null
          container_type: string | null
          created_at: string
          field_note: string | null
          field_status: string
          fraction_note: string | null
          has_card: boolean | null
          id: string
          is_flagged: boolean | null
          line_note: string | null
          line_total: number | null
          order_id: string
          pack_config_id: string | null
          price_status: string
          priced_at: string | null
          priced_by: string | null
          pricing_reference_date: string | null
          product_id: string
          product_name: string
          quantity: number
          quantity_raw: string | null
          rule_id: string | null
          shipped_at: string | null
          shipped_qty: number | null
          spec: string | null
          spec_warnings: Json | null
          subtotal: number | null
          tax_amount: number | null
          tax_rate: number
          unit: string
          unit_price: number
          updated_at: string
          version: number
        }
        Insert: {
          billable_qty?: number | null
          billable_reason?: string | null
          confidence?: number | null
          container_type?: string | null
          created_at?: string
          field_note?: string | null
          field_status?: string
          fraction_note?: string | null
          has_card?: boolean | null
          id?: string
          is_flagged?: boolean | null
          line_note?: string | null
          line_total?: number | null
          order_id: string
          pack_config_id?: string | null
          price_status?: string
          priced_at?: string | null
          priced_by?: string | null
          pricing_reference_date?: string | null
          product_id: string
          product_name: string
          quantity: number
          quantity_raw?: string | null
          rule_id?: string | null
          shipped_at?: string | null
          shipped_qty?: number | null
          spec?: string | null
          spec_warnings?: Json | null
          subtotal?: number | null
          tax_amount?: number | null
          tax_rate: number
          unit?: string
          unit_price: number
          updated_at?: string
          version?: number
        }
        Update: {
          billable_qty?: number | null
          billable_reason?: string | null
          confidence?: number | null
          container_type?: string | null
          created_at?: string
          field_note?: string | null
          field_status?: string
          fraction_note?: string | null
          has_card?: boolean | null
          id?: string
          is_flagged?: boolean | null
          line_note?: string | null
          line_total?: number | null
          order_id?: string
          pack_config_id?: string | null
          price_status?: string
          priced_at?: string | null
          priced_by?: string | null
          pricing_reference_date?: string | null
          product_id?: string
          product_name?: string
          quantity?: number
          quantity_raw?: string | null
          rule_id?: string | null
          shipped_at?: string | null
          shipped_qty?: number | null
          spec?: string | null
          spec_warnings?: Json | null
          subtotal?: number | null
          tax_amount?: number | null
          tax_rate?: number
          unit?: string
          unit_price?: number
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_pack_config_id_fkey"
            columns: ["pack_config_id"]
            isOneToOne: false
            referencedRelation: "pack_configs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_priced_by_fkey"
            columns: ["priced_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "customer_product_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      order_receipts: {
        Row: {
          channel: string
          created_at: string | null
          customer_id: string | null
          delivery_date: string | null
          error_message: string | null
          exact_hash: string | null
          id: string
          is_revision: boolean | null
          message_id: string | null
          next_retry_at: string | null
          ocr_confidence: number | null
          order_id: string | null
          parent_id: string | null
          r2_key: string | null
          raw_payload: Json | null
          received_at: string
          retry_count: number | null
          sender_date_key: string | null
          status: string
        }
        Insert: {
          channel: string
          created_at?: string | null
          customer_id?: string | null
          delivery_date?: string | null
          error_message?: string | null
          exact_hash?: string | null
          id?: string
          is_revision?: boolean | null
          message_id?: string | null
          next_retry_at?: string | null
          ocr_confidence?: number | null
          order_id?: string | null
          parent_id?: string | null
          r2_key?: string | null
          raw_payload?: Json | null
          received_at?: string
          retry_count?: number | null
          sender_date_key?: string | null
          status?: string
        }
        Update: {
          channel?: string
          created_at?: string | null
          customer_id?: string | null
          delivery_date?: string | null
          error_message?: string | null
          exact_hash?: string | null
          id?: string
          is_revision?: boolean | null
          message_id?: string | null
          next_retry_at?: string | null
          ocr_confidence?: number | null
          order_id?: string | null
          parent_id?: string | null
          r2_key?: string | null
          raw_payload?: Json | null
          received_at?: string
          retry_count?: number | null
          sender_date_key?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_receipts_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_receipts_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_receipts_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "order_receipts"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          confirmed_no_order: boolean | null
          created_at: string
          created_by: string | null
          customer_id: string
          delivery_date: string | null
          delivery_date_source: string | null
          destination_id: string | null
          id: string
          note: string | null
          order_date: string
          shipping_time: string | null
          source: string
          status: string
          updated_at: string
        }
        Insert: {
          confirmed_no_order?: boolean | null
          created_at?: string
          created_by?: string | null
          customer_id: string
          delivery_date?: string | null
          delivery_date_source?: string | null
          destination_id?: string | null
          id?: string
          note?: string | null
          order_date?: string
          shipping_time?: string | null
          source: string
          status?: string
          updated_at?: string
        }
        Update: {
          confirmed_no_order?: boolean | null
          created_at?: string
          created_by?: string | null
          customer_id?: string
          delivery_date?: string | null
          delivery_date_source?: string | null
          destination_id?: string | null
          id?: string
          note?: string | null
          order_date?: string
          shipping_time?: string | null
          source?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_destination_id_fkey"
            columns: ["destination_id"]
            isOneToOne: false
            referencedRelation: "delivery_destinations"
            referencedColumns: ["id"]
          },
        ]
      }
      pack_configs: {
        Row: {
          base_per_selling: number
          created_at: string
          customer_id: string | null
          id: string
          inner_per: number | null
          inner_unit_label: string | null
          is_active: boolean
          label: string
          needs_manual_confirm: boolean
          outer_per: number | null
          outer_unit_label: string | null
          product_id: string
          selling_unit_label: string
        }
        Insert: {
          base_per_selling: number
          created_at?: string
          customer_id?: string | null
          id?: string
          inner_per?: number | null
          inner_unit_label?: string | null
          is_active?: boolean
          label: string
          needs_manual_confirm?: boolean
          outer_per?: number | null
          outer_unit_label?: string | null
          product_id: string
          selling_unit_label: string
        }
        Update: {
          base_per_selling?: number
          created_at?: string
          customer_id?: string | null
          id?: string
          inner_per?: number | null
          inner_unit_label?: string | null
          is_active?: boolean
          label?: string
          needs_manual_confirm?: boolean
          outer_per?: number | null
          outer_unit_label?: string | null
          product_id?: string
          selling_unit_label?: string
        }
        Relationships: [
          {
            foreignKeyName: "pack_configs_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pack_configs_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      price_rules: {
        Row: {
          channel: string | null
          created_at: string
          created_by: string | null
          customer_id: string | null
          effective_from: string
          effective_to: string | null
          id: string
          note: string | null
          pack_config_id: string | null
          price_unit: string
          product_id: string
          tax_rate: number
          unit_price: number
        }
        Insert: {
          channel?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          effective_from: string
          effective_to?: string | null
          id?: string
          note?: string | null
          pack_config_id?: string | null
          price_unit?: string
          product_id: string
          tax_rate: number
          unit_price: number
        }
        Update: {
          channel?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          effective_from?: string
          effective_to?: string | null
          id?: string
          note?: string | null
          pack_config_id?: string | null
          price_unit?: string
          product_id?: string
          tax_rate?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "price_rules_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_rules_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_rules_pack_config_id_fkey"
            columns: ["pack_config_id"]
            isOneToOne: false
            referencedRelation: "pack_configs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_rules_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          aliases: string[]
          base_unit: string
          container_capacity: number | null
          created_at: string
          default_tax_rate: number
          default_unit_price: number | null
          id: string
          is_active: boolean
          name: string
          name_kana: string | null
          photo_url: string | null
          stock_qty: number
          unit: string
          updated_at: string
        }
        Insert: {
          aliases?: string[]
          base_unit?: string
          container_capacity?: number | null
          created_at?: string
          default_tax_rate?: number
          default_unit_price?: number | null
          id?: string
          is_active?: boolean
          name: string
          name_kana?: string | null
          photo_url?: string | null
          stock_qty?: number
          unit?: string
          updated_at?: string
        }
        Update: {
          aliases?: string[]
          base_unit?: string
          container_capacity?: number | null
          created_at?: string
          default_tax_rate?: number
          default_unit_price?: number | null
          id?: string
          is_active?: boolean
          name?: string
          name_kana?: string | null
          photo_url?: string | null
          stock_qty?: number
          unit?: string
          updated_at?: string
        }
        Relationships: []
      }
      spec_reports: {
        Row: {
          created_at: string
          customer_id: string | null
          handled_at: string | null
          handled_by: string | null
          id: string
          note: string
          photo_url: string | null
          product_id: string | null
          reported_by: string | null
          status: string
        }
        Insert: {
          created_at?: string
          customer_id?: string | null
          handled_at?: string | null
          handled_by?: string | null
          id?: string
          note: string
          photo_url?: string | null
          product_id?: string | null
          reported_by?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          customer_id?: string | null
          handled_at?: string | null
          handled_by?: string | null
          id?: string
          note?: string
          photo_url?: string | null
          product_id?: string | null
          reported_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "spec_reports_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spec_reports_handled_by_fkey"
            columns: ["handled_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spec_reports_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spec_reports_reported_by_fkey"
            columns: ["reported_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          role: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          role?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          role?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      v_ops_status: {
        Row: {
          approved_count: number | null
          pending_review_count: number | null
          shipped_count: number | null
          today_deliveries: number | null
          today_orders: number | null
        }
        Relationships: []
      }
      v_sales_by_customer: {
        Row: {
          customer_name: string | null
          month: string | null
          order_count: number | null
          subtotal_excl_tax: number | null
          total_incl_tax: number | null
        }
        Relationships: []
      }
      v_sales_by_item: {
        Row: {
          month: string | null
          product_name: string | null
          subtotal_excl_tax: number | null
          total_incl_tax: number | null
          total_qty: number | null
          unit: string | null
        }
        Relationships: []
      }
      v_sales_monthly: {
        Row: {
          customer_count: number | null
          month: string | null
          order_count: number | null
          subtotal_excl_tax: number | null
          total_incl_tax: number | null
          total_tax: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      get_next_delivery_note_number: {
        Args: { p_month: string }
        Returns: number
      }
      get_next_invoice_number: { Args: { p_month: string }; Returns: number }
      is_admin: { Args: never; Returns: boolean }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">
type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

// ─── 後方互換エイリアス ─────────────────────────────────────────────────────
// 旧バージョンのsupabase.tsにあった型エイリアスを再定義。新規コードでは使わない。

// 現行DBカラム＋旧スキーマカラム（UI互換のためoptionalで保持）
export type CustomerRow = Database['public']['Tables']['customers']['Row'] & {
  store_code?: string | null
  sort_order?: number | null
  tenant_id?: string | null
  fax?: string | null
  tel?: string | null
  address?: string | null
  postal_code?: string | null
}
export type ProductRow = Database['public']['Tables']['products']['Row'] & {
  tenant_id?: string | null
  category?: string | null
  default_tax_rate?: number | null
  alt_names?: string[] | null
}
export type OrderRow = Database['public']['Tables']['orders']['Row'] & {
  tenant_id?: string | null
}
export type OrderItemRow = Database['public']['Tables']['order_items']['Row'] & {
  tenant_id?: string | null
}
export type PriceMasterRow = Database['public']['Tables']['customer_product_rules']['Row'] & {
  tenant_id?: string | null
  product_name?: string | null
  customer_name?: string | null
}
export type InvoiceRow = Database['public']['Tables']['invoices']['Row']

// 旧DBに存在したがマイグレーション後に削除されたテーブルのプレースホルダー型
export type ProfileRow = Record<string, unknown> & {
  id?: string
  role?: string
  tenant_id?: string
  display_name?: string | null
}
export type ProductStandardRow = {
  id: string
  product_id: string
  name: string
  unit_size: number
  is_active: boolean
  tenant_id?: string
  [key: string]: unknown
}
export type OcrStatus = 'pending' | 'processing' | 'done' | 'error' | 'review_needed' | 'approved'
export type UnitType = string
export type ReceiptMode = string
