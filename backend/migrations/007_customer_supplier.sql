-- 中間業者（系列）カラムを customers に追加
-- 目的: 出荷表・出荷ラベルの供給先を「ヨーク 東道野辺」のように系列＋店舗で表記し、
--       現場の仕分け作業者が手書きで系列名を追記しなくても済むようにする。
-- 表示ルールは backend/app/services/destination.py に集約（DBは事実のみ保持する）。
ALTER TABLE customers ADD COLUMN IF NOT EXISTS supplier_name TEXT;

COMMENT ON COLUMN customers.supplier_name IS
  '中間業者名（系列）。例: ヨーク。店舗指定が不要な業者は name と同値にする（表示は系列名のみになる）';

-- 既存9店舗はすべてヨーク系列（本番データ確認済み・2026-07）
UPDATE customers SET supplier_name = 'ヨーク'
 WHERE name IN ('習志野台','咲が丘','青葉台','八柱','五香','鎌ケ谷','東道野辺','夏見台','八千代台')
   AND supplier_name IS NULL;

-- 寺崎（店舗指定不要の業者。これまでLINE手動運用だったものをマスタ化）
-- name = supplier_name のため、帳票表示は「寺崎」のみになる。
INSERT INTO customers (tenant_id, name, supplier_name, sort_order, is_active)
SELECT c.tenant_id, '寺崎', '寺崎', 100, TRUE
  FROM customers c
 WHERE NOT EXISTS (SELECT 1 FROM customers WHERE name = '寺崎')
 LIMIT 1;
