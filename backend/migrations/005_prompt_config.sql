-- AIプロンプト設定テーブル（メール/画像解析プロンプトをブラウザから編集）
-- フェイルセーフ: is_custom_enabled で内蔵デフォルトへ即座に切替可能
CREATE TABLE IF NOT EXISTS prompt_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' UNIQUE,
    image_prompt TEXT,                          -- 画像解析用プロンプト（NULL=内蔵デフォルト使用）
    text_prompt TEXT,                           -- テキスト解析用プロンプト（NULL=内蔵デフォルト使用）
    is_custom_enabled BOOLEAN NOT NULL DEFAULT FALSE,  -- マスタースイッチ: OFFなら常にデフォルト
    version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- バージョン履歴（ロールバック用）
CREATE TABLE IF NOT EXISTS prompt_config_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
    version INTEGER NOT NULL,
    image_prompt TEXT,
    text_prompt TEXT,
    is_custom_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    saved_by TEXT,                              -- 保存したユーザー（任意）
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_prompt_history_tenant_version
    ON prompt_config_history (tenant_id, version DESC);

-- 自動 updated_at トリガー
DROP TRIGGER IF EXISTS update_prompt_config_updated_at ON prompt_config;
CREATE TRIGGER update_prompt_config_updated_at
    BEFORE UPDATE ON prompt_config
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- RLS
ALTER TABLE prompt_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE prompt_config_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all operations for prompt_config" ON prompt_config;
CREATE POLICY "Allow all operations for prompt_config" ON prompt_config
    FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all operations for prompt_config_history" ON prompt_config_history;
CREATE POLICY "Allow all operations for prompt_config_history" ON prompt_config_history
    FOR ALL USING (true) WITH CHECK (true);

-- 初期レコード（デフォルトテナント用）
INSERT INTO prompt_config (tenant_id, is_custom_enabled)
VALUES ('00000000-0000-0000-0000-000000000001', FALSE)
ON CONFLICT (tenant_id) DO NOTHING;
