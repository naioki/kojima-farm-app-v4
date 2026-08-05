-- 008: approve_ocr_verification のセキュリティ強化
--
-- 1) SECURITY DEFINER 関数に search_path が固定されていない（権限昇格の温床）
-- 2) 未ログイン（anon）でも /rest/v1/rpc/approve_ocr_verification を叩けてしまい、
--    anon キーだけで受注を作成できる状態だった。
--    実際の呼び出しはすべて service_role（FastAPI / Next.js Server Action）なので影響なし。

ALTER FUNCTION public.approve_ocr_verification(uuid, uuid, uuid, date, text, jsonb)
  SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION public.approve_ocr_verification(uuid, uuid, uuid, date, text, jsonb) FROM anon;
