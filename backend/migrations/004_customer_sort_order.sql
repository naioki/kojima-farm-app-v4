-- 配送順カラムを customers に追加（デフォルト999=未設定は末尾）
ALTER TABLE customers ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 999;

-- 初期配送順を設定（6/5の正しい出荷一覧表の順）
UPDATE customers SET sort_order = 1 WHERE id = '42ec4a19-0c2b-46e1-a767-5bc5ff4da5ab'; -- 習志野台
UPDATE customers SET sort_order = 2 WHERE id = 'bfa56ff1-b2ec-4f47-99fd-9c046fa34886'; -- 青葉台
UPDATE customers SET sort_order = 3 WHERE id = 'edf28826-d14a-46f5-9c48-a6c27afff613'; -- 八柱
UPDATE customers SET sort_order = 4 WHERE id = '228a1057-a3e5-4ee2-aa80-309278cbf5d0'; -- 五香
UPDATE customers SET sort_order = 5 WHERE id = '690c9c16-3d8a-4e89-b300-868e437b0098'; -- 鎌ケ谷
UPDATE customers SET sort_order = 6 WHERE id = 'a2c503b8-c64e-4f39-8067-9bdad2673249'; -- 東道野辺
UPDATE customers SET sort_order = 7 WHERE id = '629bfe23-fad2-42a2-86ac-44cfdfd7257e'; -- 夏見台
UPDATE customers SET sort_order = 8 WHERE id = '25f66fc5-88d7-4d97-9fa7-893d824ebd1a'; -- 咲が丘
UPDATE customers SET sort_order = 9 WHERE id = '777b9c39-f4af-4b35-a1a9-78a809270304'; -- 八千代台
