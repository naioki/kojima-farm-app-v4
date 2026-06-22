"""
OCR router
POST /api/ocr/parse   — Gemini で画像を解析して parsed_lines を保存
POST /api/ocr/verify  — 人間が確認した行を確定し、注文レコードを作成
"""
from __future__ import annotations

import io
import os
import uuid
from typing import Any, Dict, List

from fastapi import APIRouter, HTTPException
from PIL import Image

from app.models import ParseRequest, ParseResponse, ParsedLine, VerifyRequest, VerifyResponse
from app.services.ocr_parser import parse_order_image, parse_order_text, validate_and_fix_order_data, _nk
from app.services.supabase_client import get_supabase

router = APIRouter()


# ─── helpers ─────────────────────────────────────────────────────────────────

def _download_image(image_url: str) -> Image.Image:
    """Supabase Storage の署名付き URL から画像を取得"""
    import httpx
    resp = httpx.get(image_url, timeout=30)
    resp.raise_for_status()
    return Image.open(io.BytesIO(resp.content))


async def _resolve_lines(sb, tenant_id: str, lines: list) -> list:
    """
    RPC 呼び出し前に store / item / spec を DB で検証・自動補完する。
    - item が製品名として存在しない → HTTPException 422
    - spec が空 かつ 規格が1件のみ → 自動補完
    - spec が存在しない → 利用可能規格を列挙して HTTPException 422
    """
    # 全 products / product_standards / customers をまとめて取得
    products_rows = sb.table("products").select("id, name").eq("tenant_id", tenant_id).execute()
    prod_by_name: dict = {}
    for r in (products_rows.data or []):
        prod_by_name[r["name"].strip()] = r["id"]

    ps_rows = sb.table("product_standards").select("id, name, product_id").eq("tenant_id", tenant_id).eq("is_active", True).execute()
    # {product_id: [(ps_id, ps_name), ...]}
    ps_by_product: dict = {}
    for r in (ps_rows.data or []):
        ps_by_product.setdefault(r["product_id"], []).append(r["name"].strip())

    customers_rows = sb.table("customers").select("id, name").eq("tenant_id", tenant_id).execute()
    cust_by_name: dict = {r["name"].strip(): r["id"] for r in (customers_rows.data or [])}

    resolved = []
    for i, line in enumerate(lines):
        store = line["store"].strip()
        item  = line["item"].strip()
        spec  = line["spec"].strip()

        # store チェック
        if store not in cust_by_name:
            # 部分一致で候補を探す
            candidates = [n for n in cust_by_name if store in n or n in store]
            hint = f"候補: {', '.join(candidates)}" if candidates else "マスターに登録してください"
            raise HTTPException(status_code=422, detail=f"店舗「{store}」が見つかりません。{hint}")

        # item チェック（完全一致 → 部分一致 → 前方一致の順）
        if item not in prod_by_name:
            candidates = [n for n in prod_by_name if item in n or n in item]
            if len(candidates) == 1:
                print(f"[resolve_lines] 行{i+1}: item「{item}」→ 部分一致で「{candidates[0]}」に補完")
                item = candidates[0]
            elif len(candidates) > 1:
                raise HTTPException(status_code=422, detail=f"品目「{item}」が複数の候補に一致します: {', '.join(candidates)}。承認フォームで正確な品目名を選択してください。")
            else:
                raise HTTPException(status_code=422, detail=f"品目「{item}」がマスターに存在しません。マスターに登録してください。")

        prod_id = prod_by_name[item]
        available_specs = ps_by_product.get(prod_id, [])

        # spec が空 → 自動補完（1件のみなら）
        if not spec:
            if len(available_specs) == 1:
                spec = available_specs[0]
                print(f"[resolve_lines] 行{i+1}: spec 空のため自動補完 → 「{spec}」")
            elif len(available_specs) == 0:
                raise HTTPException(status_code=422, detail=f"品目「{item}」の規格がマスターに1件もありません。マスターに登録してください。")
            else:
                raise HTTPException(status_code=422, detail=f"品目「{item}」の規格が未指定です。登録済み規格: {', '.join(available_specs)}")

        # spec チェック
        if spec not in available_specs:
            # 部分一致
            candidates = [s for s in available_specs if spec in s or s in spec]
            if len(candidates) == 1:
                print(f"[resolve_lines] 行{i+1}: spec「{spec}」→ 部分一致で「{candidates[0]}」に補完")
                spec = candidates[0]
            else:
                raise HTTPException(status_code=422, detail=f"品目「{item}」に規格「{spec}」はありません。登録済み規格: {', '.join(available_specs)}")

        resolved.append({**line, "item": item, "spec": spec, "store": store})

    return resolved


def _get_tenant_id_for_verification(verification_id: str) -> str:
    sb = get_supabase()
    row = (
        sb.table("ocr_verifications")
        .select("tenant_id")
        .eq("id", str(verification_id))
        .single()
        .execute()
    )
    if not row.data:
        raise HTTPException(status_code=404, detail="verification not found")
    return row.data["tenant_id"]


# ─── POST /api/ocr/parse ─────────────────────────────────────────────────────

@router.post("/parse", response_model=ParseResponse)
async def parse_verification(req: ParseRequest):
    """
    1. ocr_verifications から image_url を取得
    2. Supabase Storage から画像をダウンロード
    3. Gemini で解析 → validate_and_fix_order_data
    4. parsed_lines / confidence_flags を DB に保存
    5. status を needs_review に更新
    """
    sb = get_supabase()
    verification_id = str(req.verification_id)

    # 検証レコード取得
    row = (
        sb.table("ocr_verifications")
        .select("id, tenant_id, image_url, status")
        .eq("id", verification_id)
        .single()
        .execute()
    )
    if not row.data:
        raise HTTPException(status_code=404, detail="verification not found")

    verif = row.data
    image_url: str = verif["image_url"]

    api_key = os.environ.get("GEMINI_API_KEY", "")
    if not api_key:
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY not configured")

    # テキストメール vs 画像メールで分岐
    if image_url.startswith("text://"):
        # confidence_flags.raw_text から本文を取得
        flags_row = (
            sb.table("ocr_verifications")
            .select("confidence_flags")
            .eq("id", verification_id)
            .single()
            .execute()
        )
        flags = flags_row.data.get("confidence_flags") or {}
        text_body = flags.get("raw_text", "")
        if not text_body:
            raise HTTPException(status_code=422, detail="raw_text が空です")
        try:
            raw_result = parse_order_text(text_body, api_key)
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Gemini parse failed: {e}")
    else:
        # 画像ダウンロード
        try:
            image = _download_image(image_url)
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"image download failed: {e}")
        try:
            raw_result = parse_order_image(image, api_key)
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Gemini parse failed: {e}")

    if not raw_result:
        raise HTTPException(status_code=422, detail="Gemini returned empty result")

    # バリデーション
    validated, learned_stores, warnings = validate_and_fix_order_data(raw_result)

    # 既存 confidence_flags を取得してマージ（raw_text / subject / from / date を保持）
    existing_cf_row = (
        sb.table("ocr_verifications")
        .select("confidence_flags")
        .eq("id", verification_id)
        .single()
        .execute()
    )
    existing_cf: Dict[str, Any] = {}
    if existing_cf_row.data and existing_cf_row.data.get("confidence_flags"):
        existing_cf = dict(existing_cf_row.data["confidence_flags"])

    confidence_flags: Dict[str, Any] = {
        **existing_cf,
        "warnings": warnings,
        "learned_stores": learned_stores,
    }

    # DB から商品マスターを取得してスペックを自動補完
    tenant_id_for_parse = verif["tenant_id"]
    _prod_rows = sb.table("products").select("id, name, alt_names").eq("tenant_id", tenant_id_for_parse).execute()
    _prod_by_name: Dict[str, str] = {r["name"].strip(): r["id"] for r in (_prod_rows.data or [])}
    _name_by_prod: Dict[str, str] = {r["id"]: r["name"].strip() for r in (_prod_rows.data or [])}
    # 別表記（alt_names）→ product_id の正規化マップ。マスタUIで編集した別表記を解決に反映する。
    _alias_norm: Dict[str, str] = {}
    for r in (_prod_rows.data or []):
        _alias_norm[_nk(r["name"])] = r["id"]
        for a in (r.get("alt_names") or []):
            if a and a.strip():
                _alias_norm.setdefault(_nk(a), r["id"])
    _ps_rows = sb.table("product_standards").select("id, name, product_id, unit_size, receipt_mode").eq("tenant_id", tenant_id_for_parse).eq("is_active", True).execute()
    _ps_by_product: Dict[str, List[str]] = {}
    _unit_by_ps: Dict[str, int] = {}           # (product_id, spec_name) -> unit_size
    _receipt_mode_by_ps: Dict[str, str] = {}   # (product_id, spec_name) -> receipt_mode
    for r in (_ps_rows.data or []):
        _ps_by_product.setdefault(r["product_id"], []).append(r["name"].strip())
        _unit_by_ps[(r["product_id"], r["name"].strip())] = r.get("unit_size") or 0
        _receipt_mode_by_ps[(r["product_id"], r["name"].strip())] = r.get("receipt_mode") or "総数入力"

    def _resolve_prod_id(item: str, spec: str = "") -> str | None:
        """商品名から product_id を解決。
        優先順:
          1. 品目名の完全一致
          2. 別表記(alt_names)の完全一致。AIが「トマト10k」を item=トマト + spec=10k に
             分割しても、結合「トマト10k」が別表記に一致すれば トマトバラ に解決する。
          3. マスター名が item に含まれる最長一致（胡瓜＜胡瓜バラ）
          4. item がマスター名に含まれる（候補1件のみ）
        """
        item_s = item.strip()
        spec_s = (spec or "").strip()
        # 1. 完全一致
        prod_id = _prod_by_name.get(item_s)
        if prod_id:
            return prod_id
        # 2. 別表記一致（結合を優先＝より具体的）
        cand_keys = []
        if spec_s:
            cand_keys.append(_nk(item_s + spec_s))
            cand_keys.append(_nk(item_s + " " + spec_s))
        cand_keys.append(_nk(item_s))
        for k in cand_keys:
            if k and k in _alias_norm:
                return _alias_norm[k]
        # 3. マスター名が item に含まれる → 最長（最も具体的）を優先
        contained = [n for n in _prod_by_name if n and n in item_s]
        if contained:
            return _prod_by_name[max(contained, key=len)]
        # 4. item がマスター名に含まれる（AIが短く返した場合）→ 候補1件のみ採用
        candidates = [n for n in _prod_by_name if item_s and item_s in n]
        if len(candidates) == 1:
            return _prod_by_name[candidates[0]]
        return None

    def _resolve_spec(item: str, spec: str) -> str:
        """スペックが空またはマスター不一致のとき、候補1件なら自動補完"""
        prod_id = _resolve_prod_id(item)
        if not prod_id:
            return spec
        available = _ps_by_product.get(prod_id, [])
        if not available:
            return spec
        if not spec.strip():
            return available[0] if len(available) == 1 else spec
        if spec.strip() in available:
            return spec.strip()
        matched = [s for s in available if spec.strip() in s or s in spec.strip()]
        return matched[0] if len(matched) == 1 else spec

    def _resolve_unit(item: str, spec: str) -> int:
        """マスターデータの unit_size を取得（0なら未登録）"""
        prod_id = _resolve_prod_id(item)
        if not prod_id:
            return 0
        return _unit_by_ps.get((prod_id, spec.strip()), 0)

    def _resolve_receipt_mode(item: str, spec: str) -> str:
        """マスターデータの receipt_mode を取得（総数入力 / 箱数入力）"""
        prod_id = _resolve_prod_id(item)
        if not prod_id:
            return "総数入力"
        return _receipt_mode_by_ps.get((prod_id, spec.strip()), "総数入力")

    def _total_to_boxes_remainder(total: int, unit: int):
        """v3 box_remainder_calc.total_to_boxes_remainder と同一ロジック"""
        total = max(0, int(total))
        unit = int(unit)
        if unit <= 0:
            return (0, total)
        return (total // unit, total % unit)

    def _calculate_inventory(input_num: int, master_unit: int, receive_as_boxes: bool):
        """v3 box_remainder_calc.calculate_inventory と同一ロジック"""
        input_num = max(0, int(input_num))
        master_unit = max(0, int(master_unit))
        if receive_as_boxes:
            boxes = input_num
            total = boxes * master_unit if master_unit > 0 else 0
            return (total, boxes, 0, master_unit)
        total = input_num
        if master_unit <= 0:
            return (total, 0, total, 0)
        boxes, rem = _total_to_boxes_remainder(total, master_unit)
        return (total, boxes, rem, master_unit)

    # parsed_lines に confidence を付与 + スペック・unit/boxes をマスターデータで再計算（v3ロジック）
    parsed_lines_with_conf = []
    for entry in validated:
        item_name = entry.get("item", "")
        raw_item = item_name
        # マスターに解決できたら正式な品目名に正規化（別表記・item+spec結合も考慮）
        # 例: item=トマト spec=10k → トマトバラ / 胡瓜バラ(50本) → 胡瓜バラ
        _rid = _resolve_prod_id(item_name, entry.get("spec", ""))
        if _rid and _name_by_prod.get(_rid):
            item_name = _name_by_prod[_rid]
        resolved_spec = _resolve_spec(item_name, entry.get("spec", ""))
        db_unit = _resolve_unit(item_name, resolved_spec)
        receipt_mode = _resolve_receipt_mode(item_name, resolved_spec)
        receive_as_boxes = receipt_mode in ("箱数入力", "box_count")

        # ── 解決失敗を黙って通さない（silent fail 廃止）──────────────────
        # 品目がマスタに無い／規格・入数が未設定 のときは計算できないため明示フラグ。
        resolve_issue: str | None = None
        if not _rid:
            resolve_issue = f"品目「{raw_item}」がマスタ未登録です"
        elif db_unit <= 0:
            resolve_issue = f"品目「{item_name}」規格「{resolved_spec or '—'}」の入数がマスタ未設定です"
        if resolve_issue:
            warnings.append(f"⚠️ {entry.get('store','')} {resolve_issue}（数量は手動確認が必要）")
            print(f"[parse UNRESOLVED] {entry.get('store','')} {raw_item}: {resolve_issue}")

        # Gemini は input_num に「×」の直後の数字をそのまま返す
        input_num = entry.get("input_num") or entry.get("boxes", 0)
        input_num = max(0, int(input_num)) if input_num else 0

        if db_unit > 0:
            _, boxes, remainder, unit = _calculate_inventory(input_num, db_unit, receive_as_boxes)

            # ── 補正パス1: AIが total=boxes×unit で返した場合の修正 (v3 _fix_total_when_ai_sent_boxes_times_unit) ──
            # 総数モードで input_num > 1000 かつ input_num == some_boxes * db_unit の場合、
            # input_num が正しい総数のため補正不要。ただし Gemini が既に掛け算した可能性をチェック。
            if not receive_as_boxes and input_num > 1000 and db_unit > 0:
                if input_num % db_unit == 0:
                    candidate_boxes = input_num // db_unit
                    if 10 <= candidate_boxes <= 1000:
                        # input_num が実は "boxes" で渡された可能性。
                        # ただし v3 の条件: total == unit * boxes かつ boxes が 10-1000 のとき。
                        # ここでは input_num そのものが正しいかどうか判断できないので
                        # ログのみ出してそのまま使う（UI で人間が確認する）
                        print(f"[parse WARNING] {item_name} {resolved_spec}: input_num={input_num} が db_unit={db_unit} の倍数。AIが掛け算した可能性あり。boxes候補={candidate_boxes}")

        else:
            # マスター未登録: Gemini の値をそのまま使用
            unit = entry.get("unit", 0)
            boxes = input_num
            remainder = entry.get("remainder", 0)

        print(f"[parse] {entry.get('store','')} {item_name} {resolved_spec}: input_num={input_num} unit={db_unit} receipt={receipt_mode} → boxes={boxes} rem={remainder}")

        conf = 1.0
        if resolve_issue:
            conf = 0.0  # 解決不能：UI で最優先の要確認として表示
        else:
            for w in warnings:
                if item_name in w or entry.get("store", "") in w:
                    conf = 0.5
                    break
        parsed_lines_with_conf.append({
            **entry,
            "item": item_name,
            "spec": resolved_spec,
            "unit": unit,
            "boxes": boxes,
            "remainder": remainder,
            "confidence": conf,
        })

    # DB 更新
    sb.table("ocr_verifications").update(
        {
            "raw_ocr_json": raw_result,
            "parsed_lines": parsed_lines_with_conf,
            "confidence_flags": confidence_flags,
            "status": "needs_review",
        }
    ).eq("id", verification_id).execute()

    return ParseResponse(
        verification_id=req.verification_id,
        parsed_lines=[ParsedLine(**line) for line in parsed_lines_with_conf],
        confidence_flags=confidence_flags,
    )


# ─── POST /api/ocr/verify ────────────────────────────────────────────────────

@router.post("/verify", response_model=VerifyResponse)
async def verify_and_approve(req: VerifyRequest):
    """
    人間が確認・修正した行を受け取り、既存の approve_ocr_verification RPC を呼び出す。
    RPC が order を作成し order_id を返す。
    """
    sb = get_supabase()
    verification_id = str(req.verification_id)

    # ── プリフライト: status が corrected なら needs_review に戻す ──────────────
    # RPC は corrected 状態のレコードを拒否するため、承認前にリセットする。
    # 受注削除後の再承認や、前回の承認失敗後のリトライを安全に処理できる。
    status_row = (
        sb.table("ocr_verifications")
        .select("id, status, order_id")
        .eq("id", verification_id)
        .single()
        .execute()
    )
    if not status_row.data:
        raise HTTPException(status_code=404, detail="verification not found")

    current_status = status_row.data.get("status", "")
    current_order_id = status_row.data.get("order_id")

    if current_status == "corrected":
        # 既存 order_id が残っている場合はエラー（受注を先に削除してください）
        if current_order_id:
            raise HTTPException(
                status_code=409,
                detail=f"この検証はすでに受注（ID: {current_order_id[:8]}...）に紐付いています。"
                       "受注一覧から該当受注を削除してから再承認してください。",
            )
        # order_id がなければ安全にリセット
        sb.table("ocr_verifications").update({"status": "needs_review"}).eq("id", verification_id).execute()

    # RPC 呼び出し (system_design_v4.md で定義済み)
    # approve_ocr_verification(p_verification_id, p_tenant_id, p_reviewed_by,
    #                           p_order_date, p_correction_notes, p_lines)
    tenant_id = _get_tenant_id_for_verification(verification_id)

    # reviewed_by: Next.js から渡された user.id を優先、なければ tenant の admin を検索
    if req.reviewed_by:
        reviewed_by = str(req.reviewed_by)
    else:
        sb2 = get_supabase()
        admin_row = (
            sb2.table("profiles")
            .select("id")
            .eq("tenant_id", tenant_id)
            .eq("role", "admin")
            .limit(1)
            .execute()
        )
        if not admin_row.data:
            raise HTTPException(status_code=400, detail="tenant に admin ユーザーが存在しません")
        reviewed_by = admin_row.data[0]["id"]

    lines_payload = [
        {
            "store": line.store.strip(),
            "item": line.item.strip(),
            "spec": line.spec.strip(),
            "unit": line.unit,
            "boxes": line.boxes,
            "remainder": line.remainder,
        }
        for line in req.corrected_lines
    ]

    print(f"[verify_and_approve] lines_payload: {lines_payload}")

    # ── RPC 前事前チェック: store/item/spec を DB で確認・自動補完 ──────────────
    lines_payload = await _resolve_lines(sb, tenant_id, lines_payload)

    try:
        result = sb.rpc(
            "approve_ocr_verification",
            {
                "p_verification_id": verification_id,
                "p_tenant_id": tenant_id,
                "p_reviewed_by": reviewed_by,
                "p_order_date": str(req.order_date),
                "p_correction_notes": req.correction_notes or "",
                "p_lines": lines_payload,
            },
        ).execute()
    except Exception as e:
        err_str = str(e)
        print(f"[verify_and_approve] RPC例外: {type(e).__name__}: {err_str}")
        # ドメインエラー（P0001=item not found, P0002=customer not found, P0003=spec not found）
        # をそのままユーザーに伝える
        for code in ("P0001", "P0002", "P0003"):
            if code in err_str:
                # エラーメッセージ本文を取り出す
                import re
                m = re.search(r"'message':\s*'([^']+)'", err_str)
                detail = m.group(1) if m else err_str
                raise HTTPException(status_code=422, detail=detail)
        raise HTTPException(status_code=500, detail=f"承認処理エラー: {err_str}")

    print(f"[verify_and_approve] RPC result: data={result.data!r}")

    if not result.data:
        raise HTTPException(status_code=500, detail="RPC returned no order_id")

    order_id = result.data
    return VerifyResponse(order_id=order_id)
