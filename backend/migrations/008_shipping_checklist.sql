-- 積み込み・荷降ろしチェックリストの進捗を保存するテーブル
--
-- 設計の要点:
--   * 1行 = 「チェック済み」1件。チェックを外すときは行を削除する。
--     フラグ列にせず存在で表すことで、複数人が同時に触っても
--     UPSERT / DELETE だけで済み、後から上書きして戻る事故が起きない。
--   * row_key は用途で意味が変わる（どちらも文字列で表せる）:
--       mode='unload' → order_lines.id（店舗ごとの明細1行）
--       mode='load'   → "品目|規格"（品目ごとの合計1行）
--   * 受注が削除されたら進捗も消える（ON DELETE CASCADE）。
--
-- 保持期間:
--   1週間を過ぎた進捗は不要（運用上、当日〜数日で完結する）。
--   読み出し側でも7日で絞っているので、この掃除が動かなくても
--   古い行が画面に出ることはない。溜まり続けるのを防ぐための掃除。

CREATE TABLE IF NOT EXISTS shipping_checklist_checks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    -- 'load' = 積み込み（品目ごと） / 'unload' = 荷降ろし（店舗ごと）
    mode TEXT NOT NULL CHECK (mode IN ('load', 'unload')),
    row_key TEXT NOT NULL,
    checked_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    checked_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    -- 同じ行に対する二重チェックを DB 側で防ぐ（UPSERT の衝突対象）
    UNIQUE (order_id, mode, row_key)
);

-- 画面は「この受注のこのモード」をまとめて読むのでこの並びで引く
CREATE INDEX IF NOT EXISTS idx_shipping_checklist_order_mode
    ON shipping_checklist_checks (order_id, mode);

-- 掃除用（checked_at での範囲削除）
CREATE INDEX IF NOT EXISTS idx_shipping_checklist_checked_at
    ON shipping_checklist_checks (checked_at);

-- RLS の有効化
-- 既存テーブル（chat_config / prompt_config 等）と同じ方針で、ポリシーは
-- 緩めにしてテナント制限はアプリ層で掛ける。Server Action は必ず
-- tenant_id で絞っている（app/actions/checklist-actions.ts）。
-- profiles を参照するポリシーにすると RLS の循環参照になるため避けている。
ALTER TABLE shipping_checklist_checks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all operations for shipping_checklist_checks"
    ON shipping_checklist_checks;
CREATE POLICY "Allow all operations for shipping_checklist_checks"
    ON shipping_checklist_checks
    FOR ALL
    USING (true)
    WITH CHECK (true);

-- ── 古い進捗の掃除 ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION cleanup_shipping_checklist_checks()
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
    deleted integer;
BEGIN
    DELETE FROM shipping_checklist_checks
    WHERE checked_at < timezone('utc'::text, now()) - INTERVAL '7 days';
    GET DIAGNOSTICS deleted = ROW_COUNT;
    RETURN deleted;
END;
$$;

-- pg_cron が使える環境なら毎日回す。使えなくても読み出し側が7日で絞るので
-- 画面の見え方は変わらない（溜まるだけ）。
-- 手動で流す場合: SELECT cleanup_shipping_checklist_checks();
--
-- SELECT cron.schedule(
--     'cleanup-shipping-checklist',
--     '0 18 * * *',                       -- UTC 18:00 = JST 03:00
--     $$SELECT cleanup_shipping_checklist_checks()$$
-- );
