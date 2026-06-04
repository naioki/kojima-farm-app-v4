-- 印刷キュー管理テーブルの作成
CREATE TABLE IF NOT EXISTS print_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
    order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
    pdf_url TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending', -- 'pending', 'processing', 'success', 'failed'
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 自動 updated_at 更新トリガーの設定
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_print_jobs_updated_at ON print_jobs;
CREATE TRIGGER update_print_jobs_updated_at
    BEFORE UPDATE ON print_jobs
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- RLS (Row Level Security) の有効化
ALTER TABLE print_jobs ENABLE ROW LEVEL SECURITY;

-- 開発・動作検証用簡易ポリシー（全操作許可、実際の運用に応じてテナント制限を掛けてください）
DROP POLICY IF EXISTS "Allow all operations for print_jobs" ON print_jobs;
CREATE POLICY "Allow all operations for print_jobs" ON print_jobs
    FOR ALL
    USING (true)
    WITH CHECK (true);
