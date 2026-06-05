-- チャット連携設定テーブルの作成
CREATE TABLE IF NOT EXISTS chat_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' UNIQUE,
    discord_webhook_url TEXT,
    line_works_bot_id TEXT,
    line_works_api_token TEXT,
    google_chat_webhook_url TEXT,
    allowed_line_users TEXT, -- カンマ区切りのリスト
    allowed_discord_users TEXT, -- カンマ区切りのリスト
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 自動 updated_at トリガー
DROP TRIGGER IF EXISTS update_chat_config_updated_at ON chat_config;
CREATE TRIGGER update_chat_config_updated_at
    BEFORE UPDATE ON chat_config
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- RLS (Row Level Security) の有効化
ALTER TABLE chat_config ENABLE ROW LEVEL SECURITY;

-- 開発・動作検証用簡易ポリシー（全操作許可、実際の運用に応じてテナント制限を掛けてください）
DROP POLICY IF EXISTS "Allow all operations for chat_config" ON chat_config;
CREATE POLICY "Allow all operations for chat_config" ON chat_config
    FOR ALL
    USING (true)
    WITH CHECK (true);

-- 初期レコード（デフォルトテナント用）のインサート
INSERT INTO chat_config (tenant_id)
VALUES ('00000000-0000-0000-0000-000000000001')
ON CONFLICT (tenant_id) DO NOTHING;
