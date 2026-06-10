"""
チャット自動注文処理＆自動印刷コアサービス
"""
from __future__ import annotations

import io
import os
import tempfile
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID

from app.services.email_reader import check_email_for_orders
from app.services.ocr_parser import (
    parse_order_image,
    parse_order_text,
    validate_and_fix_order_data,
    generate_labels_from_data,
    generate_summary_table
)
from app.services.supabase_client import get_supabase
from app.services.pdf_generator import LabelPDFGenerator

# デフォルトテナント
_DEFAULT_TENANT_ID = os.environ.get(
    "DEFAULT_TENANT_ID", "00000000-0000-0000-0000-000000000001"
)
_FONT_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "assets", "ipaexg.ttf")


def _get_api_key() -> str:
    return os.environ.get("GEMINI_API_KEY", "")


def _get_email_config() -> dict:
    sb = get_supabase()
    try:
        rows = sb.table("email_config").select("*").eq("tenant_id", _DEFAULT_TENANT_ID).limit(1).execute()
        if rows.data:
            return rows.data[0]
    except Exception as e:
        print(f"[chat_automation config] Supabase fetch error: {e}")
    
    return {
        "imap_server": os.environ.get("EMAIL_IMAP_SERVER", ""),
        "imap_port": int(os.environ.get("EMAIL_IMAP_PORT", "993")),
        "email_address": os.environ.get("EMAIL_ADDRESS", ""),
        "password": os.environ.get("EMAIL_PASSWORD", ""),
        "sender_email": os.environ.get("EMAIL_SENDER_FILTER", None),
        "days_back": int(os.environ.get("EMAIL_DAYS_BACK", "3")),
    }


def _resolve_lines(sb, tenant_id: str, lines: list) -> list:
    """ocr.py と同様の店舗/品目/規格の自動補完・検証ロジック"""
    products_rows = sb.table("products").select("id, name").eq("tenant_id", tenant_id).execute()
    prod_by_name = {r["name"].strip(): r["id"] for r in (products_rows.data or [])}

    ps_rows = sb.table("product_standards").select("id, name, product_id").eq("tenant_id", tenant_id).eq("is_active", True).execute()
    ps_by_product = {}
    for r in (ps_rows.data or []):
        ps_by_product.setdefault(r["product_id"], []).append(r["name"].strip())

    customers_rows = sb.table("customers").select("id, name").eq("tenant_id", tenant_id).execute()
    cust_by_name = {r["name"].strip(): r["id"] for r in (customers_rows.data or [])}

    resolved = []
    for i, line in enumerate(lines):
        store = line["store"].strip()
        item  = line["item"].strip()
        spec  = line["spec"].strip()

        if store not in cust_by_name:
            candidates = [n for n in cust_by_name if store in n or n in store]
            hint = f"候補: {', '.join(candidates)}" if candidates else "マスターに未登録"
            raise ValueError(f"店舗「{store}」が見つかりません。({hint})")

        if item not in prod_by_name:
            candidates = [n for n in prod_by_name if item in n or n in item]
            if len(candidates) == 1:
                item = candidates[0]
            elif len(candidates) > 1:
                raise ValueError(f"品目「{item}」が複数の候補に一致します: {', '.join(candidates)}")
            else:
                raise ValueError(f"品目「{item}」が商品マスタにありません。")

        prod_id = prod_by_name[item]
        available_specs = ps_by_product.get(prod_id, [])

        if not spec:
            if len(available_specs) == 1:
                spec = available_specs[0]
            elif len(available_specs) == 0:
                raise ValueError(f"品目「{item}」の規格がマスタに登録されていません。")
            else:
                raise ValueError(f"品目「{item}」の規格を指定してください。登録済み規格: {', '.join(available_specs)}")

        if spec not in available_specs:
            candidates = [s for s in available_specs if spec in s or s in spec]
            if len(candidates) == 1:
                spec = candidates[0]
            else:
                raise ValueError(f"品目「{item}」に規格「{spec}」はありません。登録規格: {', '.join(available_specs)}")

        resolved.append({**line, "item": item, "spec": spec, "store": store})

    return resolved


def _fetch_order_lines(sb, order_id: str) -> List[Dict]:
    """orders.py と同様に明細を結合フェッチ"""
    lines_rows = sb.table("order_lines").select(
        "id, customer_id, product_standard_id, boxes, remainder, total_qty, unit_price, line_total"
    ).eq("order_id", order_id).execute()
    if not lines_rows.data:
        return []

    customer_ids = list({lr["customer_id"] for lr in lines_rows.data if lr.get("customer_id")})
    ps_ids       = list({lr["product_standard_id"] for lr in lines_rows.data if lr.get("product_standard_id")})

    customers = {}
    if customer_ids:
        c_rows = sb.table("customers").select("id, name").in_("id", customer_ids).execute()
        customers = {r["id"]: r["name"] for r in (c_rows.data or [])}

    ps_map = {}
    if ps_ids:
        p_rows = sb.table("product_standards").select("id, name, unit_size, unit_type, products(name)").in_("id", ps_ids).execute()
        for r in (p_rows.data or []):
            prod = r.get("products")
            ps_map[r["id"]] = {
                "spec": r.get("name", ""),
                "unit_size": int(r.get("unit_size") or 0),
                "unit_type": r.get("unit_type") or "",
                "product_name": prod.get("name", "") if isinstance(prod, dict) else "",
            }

    order_data = []
    for lr in lines_rows.data:
        ps = ps_map.get(lr.get("product_standard_id", ""), {})
        order_data.append({
            "store": customers.get(lr.get("customer_id", ""), ""),
            "item": ps.get("product_name", ""),
            "spec": ps.get("spec", ""),
            "unit": ps.get("unit_size", 0),
            "unit_type": ps.get("unit_type", ""),
            "boxes": lr["boxes"],
            "remainder": lr["remainder"],
            "total_qty": lr["total_qty"],
        })
    return order_data


async def fetch_recent_emails(days: int = 3) -> Dict[str, Any]:
    """直近N日分のメールを取得・解析してocr_verificationsに登録する"""
    from datetime import timedelta
    today = datetime.now().date()
    total_new = 0
    errors = []
    for i in range(days):
        target = (today - timedelta(days=i)).strftime("%Y-%m-%d")
        try:
            res = await fetch_and_parse_for_date(target)
            if res["success"]:
                total_new += len(res.get("verifications", []))
            else:
                errors.append(f"{target}: {res.get('error','')}")
        except Exception as e:
            errors.append(f"{target}: {e}")
    return {"success": True, "new_count": total_new, "errors": errors}


def get_pending_verifications(limit: int = 5) -> List[Dict]:
    """未確定（未承認）のOCR検証レコードを取得する"""
    sb = get_supabase()
    try:
        rows = (
            sb.table("ocr_verifications")
            .select("id, status, parsed_lines, confidence_flags, created_at")
            .eq("tenant_id", _DEFAULT_TENANT_ID)
            .neq("status", "corrected")
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
        result = []
        for r in (rows.data or []):
            flags = r.get("confidence_flags") or {}
            result.append({
                "verification_id": r["id"],
                "subject": flags.get("subject", "（件名なし）"),
                "from": flags.get("from", ""),
                "lines": r.get("parsed_lines") or [],
                "status": r.get("status", ""),
                "created_at": r.get("created_at", ""),
            })
        return result
    except Exception as e:
        print(f"[get_pending_verifications] error: {e}")
        return []


def get_recent_orders(limit: int = 3) -> List[Dict]:
    """DBから最新の確定済み受注を取得する"""
    try:
        sb = get_supabase()
        rows = (
            sb.table("orders")
            .select("id, order_date, status, notes")
            .eq("tenant_id", _DEFAULT_TENANT_ID)
            .in_("status", ["verified", "shipped"])
            .order("order_date", desc=True)
            .limit(limit * 3)
            .execute()
        )
        print(f"[get_recent_orders] found {len(rows.data) if rows.data else 0} orders")
        if not rows.data:
            return []

        seen_dates: set[str] = set()
        result = []
        for r in rows.data:
            d = r["order_date"]
            if d not in seen_dates:
                seen_dates.add(d)
                lines_count = sb.table("order_lines").select("id", count="exact").eq("order_id", r["id"]).execute()
                r["line_count"] = lines_count.count or 0
                result.append(r)
            if len(result) >= limit:
                break
        return result
    except Exception as e:
        print(f"[get_recent_orders] ERROR: {e}")
        return []


async def queue_print_for_existing_order(order_id: str, order_date: str) -> Dict[str, Any]:
    """既存の確定済み受注からPDFを生成してprint_jobsに登録する"""
    sb = get_supabase()

    order_data = _fetch_order_lines(sb, order_id)
    if not order_data:
        return {"success": False, "error": "受注明細が見つかりません。"}

    labels = generate_labels_from_data(order_data, order_date)
    summary_data = generate_summary_table(order_data)

    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        tmp_path = tmp.name

    try:
        generator = LabelPDFGenerator(font_path=_FONT_PATH)
        generator.generate_pdf(labels, summary_data, order_date, tmp_path)
        with open(tmp_path, "rb") as f:
            pdf_bytes = f.read()
    except Exception as e:
        return {"success": False, "error": f"PDF生成失敗: {e}"}
    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)

    pdf_filename = f"shipping_labels_{order_date.replace('-', '')}_{order_id[:8]}.pdf"
    storage_path = f"shipping-pdfs/{order_date.replace('-', '')}/{pdf_filename}"

    try:
        sb.storage.from_("fax-images").upload(
            path=storage_path,
            file=pdf_bytes,
            file_options={"content-type": "application/pdf"},
        )
        signed = sb.storage.from_("fax-images").create_signed_url(path=storage_path, expires_in=365*24*3600)
        pdf_url = signed.get("signedURL") or signed.get("signedUrl", storage_path)
    except Exception as e:
        return {"success": False, "error": f"PDFアップロード失敗: {e}"}

    try:
        job_row = sb.table("print_jobs").insert({
            "tenant_id": _DEFAULT_TENANT_ID,
            "order_id": order_id,
            "pdf_url": pdf_url,
            "status": "pending",
        }).select("id").execute()
        job_id = job_row.data[0]["id"]
    except Exception as e:
        return {"success": False, "error": f"印刷キュー登録失敗: {e}"}

    return {"success": True, "order_id": order_id, "job_id": job_id, "pdf_url": pdf_url, "line_count": len(order_data)}


# ─── コアロジック ─────────────────────────────────────────────────────────────

async def fetch_and_parse_for_date(target_date_str: str) -> Dict[str, Any]:
    """
    指定日の新規メールを取得・解析して ocr_verifications を作成。
    対話型確認用に、見つかった verifications のメタ情報リストを返す。
    """
    config = _get_email_config()
    api_key = _get_api_key()
    if not api_key:
        return {"success": False, "error": "GEMINI_API_KEY が設定されていません。"}

    # メールフェッチ (days_back は指定日に届くメールを網羅するために7日前まで広めに取る)
    try:
        results = check_email_for_orders(
            imap_server=config.get("imap_server", ""),
            email_address=config.get("email_address", ""),
            password=config.get("password", ""),
            sender_email=config.get("sender_email"),
            days_back=7,
            imap_port=int(config.get("imap_port", 993)),
        )
    except Exception as e:
        return {"success": False, "error": f"メール受信失敗: {e}"}

    sb = get_supabase()
    
    # 既登録チェック
    try:
        existing_rows = sb.table("ocr_verifications").select("confidence_flags").eq("tenant_id", _DEFAULT_TENANT_ID).execute()
        registered = {r.get("confidence_flags", {}).get("email_id") for r in (existing_rows.data or []) if r.get("confidence_flags")}
    except Exception:
        registered = set()

    found_jobs = []

    # 日付オブジェクトに変換
    try:
        target_date = datetime.strptime(target_date_str, "%Y-%m-%d").date()
    except ValueError:
        return {"success": False, "error": "日付フォーマットは YYYY-MM-DD である必要があります。"}

    for res in results:
        email_date: datetime = res.get("date", datetime.now())
        # メール受信日（または注文日）がターゲット日付と一致しているか
        if email_date.date() != target_date:
            continue

        email_id = res.get("email_id")
        if email_id and email_id in registered:
            continue

        subject = res.get("subject", "")
        result_type = res.get("type", "image")
        verif_id = str(uuid.uuid4())

        # 重複ガードに追加
        if email_id:
            registered.add(email_id)

        parsed_lines = []
        raw_ocr_json = {}
        status = "pending"
        image_url = ""

        # 1. テキストメールの場合の処理
        if result_type == "text":
            text_body = res.get("text_body", "")
            image_url = f"text://{verif_id}"
            
            if text_body:
                try:
                    raw = parse_order_text(text_body, api_key)
                    validated, _, warnings = validate_and_fix_order_data(raw)
                    parsed_lines = [
                        {**e, "confidence": 0.5 if any(e.get("store", "") in w or e.get("item", "") in w for w in warnings) else 1.0}
                        for e in validated
                    ]
                    raw_ocr_json = raw
                    status = "needs_review"
                except Exception as e:
                    print(f"[chat_automation] text parse error: {e}")

            confidence_flags = {
                "source": "text_email",
                "subject": subject,
                "email_id": email_id,
                "from": str(res.get("from", "")),
                "date": email_date.isoformat(),
                "raw_text": text_body[:4000] if text_body else "",
            }

        # 2. 画像メールの場合の処理
        else:
            image = res["image"]
            buf = io.BytesIO()
            fmt = "JPEG" if image.format in (None, "JPEG") else image.format
            image.save(buf, format=fmt)
            image_bytes = buf.getvalue()
            content_type = "image/jpeg" if fmt == "JPEG" else f"image/{fmt.lower()}"

            date_prefix = email_date.strftime("%Y%m%d")
            storage_path = f"fax-images/{date_prefix}/{uuid.uuid4().hex}_{res.get('filename', 'order.jpg')}"
            
            try:
                sb.storage.from_("fax-images").upload(
                    path=storage_path,
                    file=image_bytes,
                    file_options={"content-type": content_type},
                )
                signed = sb.storage.from_("fax-images").create_signed_url(path=storage_path, expires_in=365*24*3600)
                image_url = signed.get("signedURL") or signed.get("signedUrl", storage_path)
            except Exception as e:
                print(f"[chat_automation] Storage upload failed: {e}")
                continue

            # 画像の OCR 解析を実行
            try:
                raw = parse_order_image(image, api_key)
                validated, _, warnings = validate_and_fix_order_data(raw)
                parsed_lines = [
                    {**e, "confidence": 0.5 if any(e.get("store", "") in w or e.get("item", "") in w for w in warnings) else 1.0}
                    for e in validated
                ]
                raw_ocr_json = raw
                status = "needs_review"
            except Exception as e:
                print(f"[chat_automation] image parse error: {e}")

            confidence_flags = {
                "source": "image_email",
                "email_id": email_id,
                "subject": subject,
                "from": str(res.get("from", "")),
                "date": email_date.isoformat(),
                "warnings": warnings if 'warnings' in locals() else [],
            }

        # レコード作成
        try:
            sb.table("ocr_verifications").insert({
                "id": verif_id,
                "tenant_id": _DEFAULT_TENANT_ID,
                "image_url": image_url,
                "status": status,
                "raw_ocr_json": raw_ocr_json,
                "parsed_lines": parsed_lines,
                "confidence_flags": confidence_flags,
            }).execute()

            found_jobs.append({
                "verification_id": verif_id,
                "subject": subject,
                "from": res.get("from", ""),
                "type": result_type,
                "lines": parsed_lines,
            })
        except Exception as e:
            print(f"[chat_automation] DB insert failed for '{subject}': {e}")

    return {"success": True, "verifications": found_jobs}


async def approve_and_queue_print(verification_id: str, order_date_str: str, reviewed_by: str | None = None) -> Dict[str, Any]:
    """
    指定された verification_id を承認（確定）して orders を作成し、
    PDF 出荷ラベルを自動で生成・ストレージアップロードし、print_jobs にキューイングする。
    """
    sb = get_supabase()
    verif_id_str = str(verification_id)

    # 1. 既存レコードの確認
    verif_row = sb.table("ocr_verifications").select("*").eq("id", verif_id_str).limit(1).execute()
    if not verif_row.data:
        return {"success": False, "error": "該当の検証レコードが見つかりません。"}

    verif = verif_row.data[0]
    if verif.get("status") == "corrected" and verif.get("order_id"):
        # 既に承認済みの場合はそのまま再印刷キューに登録する
        existing_order_id = verif["order_id"]
        return await queue_print_for_existing_order(existing_order_id, order_date_str)

    # reviewed_by の決定
    if not reviewed_by:
        admin_row = sb.table("profiles").select("id").eq("tenant_id", _DEFAULT_TENANT_ID).eq("role", "admin").limit(1).execute()
        reviewed_by = admin_row.data[0]["id"] if admin_row.data else None
    
    if not reviewed_by:
        return {"success": False, "error": "承認に必要な管理者プロフィールが見つかりません。"}

    # lines の自動解決と補完
    lines_payload = [
        {
            "store": line["store"].strip(),
            "item": line["item"].strip(),
            "spec": line["spec"].strip(),
            "unit": int(line.get("unit") or 0),
            "boxes": int(line.get("boxes") or 0),
            "remainder": int(line.get("remainder") or 0),
        }
        for line in (verif.get("parsed_lines") or [])
    ]

    try:
        lines_payload = _resolve_lines(sb, _DEFAULT_TENANT_ID, lines_payload)
    except Exception as e:
        return {"success": False, "error": f"データマスタの解決に失敗しました: {e}"}

    # 2. RPC コールで注文作成
    try:
        rpc_result = sb.rpc(
            "approve_ocr_verification",
            {
                "p_verification_id": verif_id_str,
                "p_tenant_id": _DEFAULT_TENANT_ID,
                "p_reviewed_by": str(reviewed_by),
                "p_order_date": order_date_str,
                "p_correction_notes": "Approved via ChatBot Auto-action",
                "p_lines": lines_payload,
            }
        ).execute()
    except Exception as e:
        return {"success": False, "error": f"RPC承認実行エラー: {e}"}

    order_id = rpc_result.data
    if not order_id:
        return {"success": False, "error": "RPC 承認処理が失敗しました。"}

    # 3. PDF 出荷ラベルの生成
    order_data = _fetch_order_lines(sb, order_id)
    labels = generate_labels_from_data(order_data, order_date_str)
    summary_data = generate_summary_table(order_data)

    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        tmp_path = tmp.name

    try:
        generator = LabelPDFGenerator(font_path=_FONT_PATH)
        generator.generate_pdf(labels, summary_data, order_date_str, tmp_path)
        with open(tmp_path, "rb") as f:
            pdf_bytes = f.read()
    except Exception as e:
        return {"success": False, "error": f"PDF生成失敗: {e}"}
    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)

    # 4. Storage へのアップロード
    pdf_filename = f"shipping_labels_{order_date_str.replace('-', '')}_{order_id[:8]}.pdf"
    storage_path = f"shipping-pdfs/{order_date_str.replace('-', '')}/{pdf_filename}"
    
    try:
        sb.storage.from_("fax-images").upload(
            path=storage_path,
            file=pdf_bytes,
            file_options={"content-type": "application/pdf"},
        )
        signed = sb.storage.from_("fax-images").create_signed_url(path=storage_path, expires_in=365*24*3600)
        pdf_url = signed.get("signedURL") or signed.get("signedUrl", storage_path)
    except Exception as e:
        return {"success": False, "error": f"PDFアップロード失敗: {e}"}

    # 5. print_jobs テーブルへのジョブインサート
    try:
        job_row = sb.table("print_jobs").insert({
            "tenant_id": _DEFAULT_TENANT_ID,
            "order_id": order_id,
            "pdf_url": pdf_url,
            "status": "pending",
        }).select("id").execute()

        job_id = job_row.data[0]["id"]
    except Exception as e:
        return {"success": False, "error": f"印刷キュー登録失敗: {e}"}

    return {
        "success": True,
        "order_id": order_id,
        "job_id": job_id,
        "pdf_url": pdf_url,
        "lines": order_data
    }


async def modify_verification_lines(verification_id: str, notes: str) -> Dict[str, Any]:
    """
    指定された verification_id の parsed_lines を、ユーザーの修正指示 notes に基づいて
    Gemini で修正・更新します。
    """
    sb = get_supabase()
    verif_id_str = str(verification_id)

    # 1. 既存レコードの確認
    verif_row = sb.table("ocr_verifications").select("*").eq("id", verif_id_str).limit(1).execute()
    if not verif_row.data:
        return {"success": False, "error": "該当の検証レコードが見つかりません。"}

    verif = verif_row.data[0]
    current_lines = verif.get("parsed_lines") or []
    
    api_key = _get_api_key()
    if not api_key:
        return {"success": False, "error": "GEMINI_API_KEY が設定されていません。"}

    try:
        # 修正実行
        from app.services.ocr_parser import modify_order_data_with_notes
        updated_lines = modify_order_data_with_notes(current_lines, notes, api_key)
        
        # 検証・補正処理を通して、店舗名や品目名のフォーマットを再度安全にする
        validated_lines, _, _ = validate_and_fix_order_data(updated_lines, auto_learn=False)
        
    except Exception as e:
        return {"success": False, "error": f"修正処理に失敗しました: {e}"}

    # 2. レコード更新
    try:
        sb.table("ocr_verifications").update({
            "parsed_lines": validated_lines,
            "status": "needs_review", # 再レビュー待ちに維持
        }).eq("id", verif_id_str).execute()
    except Exception as e:
        return {"success": False, "error": f"DBの更新に失敗しました: {e}"}

    return {
        "success": True,
        "verification_id": verif_id_str,
        "subject": verif.get("confidence_flags", {}).get("subject", "注文書"),
        "from": verif.get("confidence_flags", {}).get("from", ""),
        "lines": validated_lines
    }

