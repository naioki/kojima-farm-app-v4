-- 品目名の重複を物理的に防止（同名2品目による解決衝突の根本対策）
-- 例: トマト(スタンドパック) と トマト(10k=トマトバラ) が同名「トマト」で並存し、
--     内部マップが衝突して全て一方に誤解決された事故への恒久対策。
ALTER TABLE products
  ADD CONSTRAINT uniq_products_tenant_name UNIQUE (tenant_id, name);
