-- email_config テーブル作成（まだ存在しない場合）
-- Supabase SQL エディタで実行してください
-- https://supabase.com/dashboard/project/hynedtzwxuinruxsxvlm/sql/new

CREATE TABLE IF NOT EXISTS public.email_config (
    id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id     uuid NOT NULL UNIQUE,
    imap_server   text NOT NULL DEFAULT '',
    email_address text NOT NULL DEFAULT '',
    password      text,
    sender_email  text,
    days_back     int  NOT NULL DEFAULT 1,
    created_at    timestamptz DEFAULT now(),
    updated_at    timestamptz DEFAULT now()
);

ALTER TABLE public.email_config ENABLE ROW LEVEL SECURITY;

-- service role はすべての操作を許可
CREATE POLICY IF NOT EXISTS "service_role_all" ON public.email_config
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- デフォルトテナントの設定を挿入（存在しない場合のみ）
INSERT INTO public.email_config (tenant_id, imap_server, email_address, days_back)
VALUES ('00000000-0000-0000-0000-000000000001', '', '', 1)
ON CONFLICT (tenant_id) DO NOTHING;
