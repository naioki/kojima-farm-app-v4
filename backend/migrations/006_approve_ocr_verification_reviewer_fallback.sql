-- 006: approve_ocr_verification の reviewer 解決を堅牢化
--
-- 背景:
--   承認時に orders.created_by へ p_reviewed_by をそのまま INSERT していたため、
--   呼び出し元が実在しない UUID（例: 00000000-0000-0000-0000-000000000000）を
--   渡すと orders_created_by_fkey (auth.users) 違反で承認処理全体が失敗していた。
--
-- 対応:
--   関数内で reviewer を解決する。
--     1) p_reviewed_by が profiles と auth.users の両方に存在すればそれを使う
--     2) 存在しなければ同一テナントの admin（profiles ∩ auth.users）にフォールバック
--     3) それも無ければ同一テナントの任意ユーザー
--     4) 最終的に見つからなければ NULL（orders.created_by / reviewed_by は nullable）
--   これにより「誰が承認したか」の記録は失われても、承認業務自体は止まらない。

CREATE OR REPLACE FUNCTION public.approve_ocr_verification(
  p_verification_id uuid,
  p_tenant_id uuid,
  p_reviewed_by uuid,
  p_order_date date,
  p_correction_notes text,
  p_lines jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_order_id uuid;
  v_line jsonb;
  v_customer_id uuid;
  v_product_standard_id uuid;
  v_reviewer uuid;
BEGIN
  -- 検証レコードの存在確認
  IF NOT EXISTS (
    SELECT 1 FROM public.ocr_verifications
    WHERE id = p_verification_id AND tenant_id = p_tenant_id
    AND status IN ('pending','needs_review')
  ) THEN
    RAISE EXCEPTION 'Verification not found or already processed' USING ERRCODE = 'P0001';
  END IF;

  -- ── reviewer 解決 ────────────────────────────────────────────────────────
  -- orders.created_by は auth.users を、ocr_verifications.reviewed_by は
  -- profiles を参照するため、両方に存在する id のみ採用する。
  SELECT pr.id INTO v_reviewer
  FROM public.profiles pr
  JOIN auth.users u ON u.id = pr.id
  WHERE pr.id = p_reviewed_by;

  IF v_reviewer IS NULL THEN
    SELECT pr.id INTO v_reviewer
    FROM public.profiles pr
    JOIN auth.users u ON u.id = pr.id
    WHERE pr.tenant_id = p_tenant_id AND pr.role = 'admin'
    ORDER BY pr.created_at
    LIMIT 1;
  END IF;

  IF v_reviewer IS NULL THEN
    SELECT pr.id INTO v_reviewer
    FROM public.profiles pr
    JOIN auth.users u ON u.id = pr.id
    WHERE pr.tenant_id = p_tenant_id
    ORDER BY pr.created_at
    LIMIT 1;
  END IF;

  -- 受注レコード作成
  INSERT INTO public.orders (tenant_id, order_date, source, status, created_by)
  VALUES (p_tenant_id, p_order_date, 'ocr', 'pending', v_reviewer)
  RETURNING id INTO v_order_id;

  -- 明細行を挿入
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    -- customer_id を store_code または name で解決
    SELECT id INTO v_customer_id
    FROM public.customers
    WHERE tenant_id = p_tenant_id
      AND (store_code = (v_line->>'store') OR name = (v_line->>'store'))
      AND is_active = true
    LIMIT 1;

    IF v_customer_id IS NULL THEN
      RAISE EXCEPTION 'Customer not found: %', (v_line->>'store') USING ERRCODE = 'P0002';
    END IF;

    -- product_standard_id を item+spec で解決
    SELECT ps.id INTO v_product_standard_id
    FROM public.product_standards ps
    JOIN public.products p ON p.id = ps.product_id
    WHERE ps.tenant_id = p_tenant_id
      AND (p.name = (v_line->>'item') OR (v_line->>'item') = ANY(p.alt_names))
      AND ps.name = (v_line->>'spec')
      AND ps.is_active = true
    LIMIT 1;

    IF v_product_standard_id IS NULL THEN
      RAISE EXCEPTION 'Product standard not found: % %', (v_line->>'item'), (v_line->>'spec') USING ERRCODE = 'P0003';
    END IF;

    INSERT INTO public.order_lines (
      tenant_id, order_id, customer_id, product_standard_id,
      boxes, remainder, total_qty
    ) VALUES (
      p_tenant_id, v_order_id, v_customer_id, v_product_standard_id,
      COALESCE((v_line->>'boxes')::integer, 0),
      COALESCE((v_line->>'remainder')::integer, 0),
      COALESCE((v_line->>'total_qty')::integer, 0)
    );
  END LOOP;

  -- ocr_verifications を更新
  UPDATE public.ocr_verifications SET
    status = 'corrected',
    order_id = v_order_id,
    reviewed_by = v_reviewer,
    reviewed_at = now(),
    correction_notes = p_correction_notes
  WHERE id = p_verification_id;

  RETURN v_order_id;
END;
$function$;
