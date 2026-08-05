-- 007: email_config テーブルを正しく作成する
--
-- 背景:
--   001_email_config.sql は
--     (a) `CREATE POLICY IF NOT EXISTS` という PostgreSQL に存在しない構文を使っており
--         実行時にエラーになる（1トランザクションのためテーブル作成ごとロールバックされる）
--     (b) コードが読み書きする imap_port 列が定義されていない
--   ため、本番 DB に email_config テーブルが存在しない状態になっていた。
--
--   その結果 PUT /api/config/email は毎回 Supabase 保存に失敗し、
--   フォールバックでコンテナ内の backend/.env.local に書き込んでいた。
--   Cloud Run のファイルシステムは揮発性のため、インスタンスが再作成されると
--   メール設定が消え、「たまにメールの自動取得ができず再登録が必要」になっていた。

CREATE TABLE IF NOT EXISTS public.email_config (
    id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id     uuid NOT NULL UNIQUE,
    imap_server   text NOT NULL DEFAULT '',
    imap_port     int  NOT NULL DEFAULT 993,
    email_address text NOT NULL DEFAULT '',
    password      text,
    sender_email  text,
    days_back     int  NOT NULL DEFAULT 1,
    created_at    timestamptz DEFAULT now(),
    updated_at    timestamptz DEFAULT now()
);

-- 既存テーブルがあった場合の列追加（冪等）
ALTER TABLE public.email_config ADD COLUMN IF NOT EXISTS imap_port int NOT NULL DEFAULT 993;

ALTER TABLE public.email_config ENABLE ROW LEVEL SECURITY;

-- service_role のみアクセス可（パスワードを保持するため anon/authenticated には開けない）
DROP POLICY IF EXISTS "service_role_all" ON public.email_config;
CREATE POLICY "service_role_all" ON public.email_config
    FOR ALL TO service_role USING (true) WITH CHECK (true);

INSERT INTO public.email_config (tenant_id, imap_server, email_address, days_back)
VALUES ('00000000-0000-0000-0000-000000000001', '', '', 1)
ON CONFLICT (tenant_id) DO NOTHING;
