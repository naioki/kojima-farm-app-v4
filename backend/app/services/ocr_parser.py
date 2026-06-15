"""
OCR Parser Service
Gemini API による FAX 画像の解析 + バリデーション。
v3 app.py から Streamlit 依存を除去してポーティング。
"""
from __future__ import annotations

import json
import re
from typing import Any, Dict, List, Optional


from google import genai
from google.genai import types as genai_types
from PIL import Image

from app.services.config_manager import (
    get_box_count_items,
    get_item_setting,
    add_unit_if_new,
    load_item_settings,
    load_items,
    load_stores,
    auto_learn_item,
    auto_learn_store,
    lookup_unit,
)
from app.services.prompt_manager import (
    DEFAULT_IMAGE_PROMPT,
    DEFAULT_TEXT_PROMPT,
    get_active_image_prompt,
    get_active_text_prompt,
    render_prompt,
)


# ─── helpers ─────────────────────────────────────────────────────────────────

def safe_int(v: Any) -> int:
    """安全に整数へ変換"""
    if v is None:
        return 0
    if isinstance(v, int):
        return v
    s = re.sub(r"\D", "", str(v))
    return int(s) if s else 0


def get_unit_label_for_item(item: str, spec: str) -> str:
    """
    品目名と規格から単位ラベルを判定（品目設定を優先）。
    v3 app.py の get_unit_label_for_item() と完全同一ロジック。
    """
    setting = get_item_setting(item)
    if setting.get("unit_type"):
        return setting["unit_type"]

    # フォールバック: 文字列マッチング
    if "長ねぎバラ" in item or "長ネギバラ" in item or "ネギバラ" in item or "ねぎバラ" in item or "長ねぎばら" in item:
        return "本"
    if ("ネギ" in item or "ねぎ" in item) and "バラ" not in item and "ばら" not in item:
        return "袋"
    if "胡瓜バラ" in item or "きゅうりバラ" in item or "キュウリバラ" in item or "胡瓜ばら" in item:
        return "本"
    if ("胡瓜" in item or "きゅうり" in item) and "バラ" not in item and "ばら" not in item:
        return "袋"
    spec_lower = spec.lower() if spec else ""
    if "バラ" in spec or "ばら" in spec_lower:
        if "胡瓜" in item or "きゅうり" in item:
            return "本"
        if "ネギ" in item or "ねぎ" in item:
            return "本"
    if "春菊" in item or "青梗菜" in item or "チンゲン菜" in item:
        return "袋"
    return "本"


# ─── Gemini クライアント・モデル選択（起動後1回だけ解決してキャッシュ） ───────

# 試行する優先モデルリスト（gemini-3.1-flash-lite 優先）
_CANDIDATE_MODELS = [
    "gemini-3.1-flash-lite",
    "gemini-3.5-flash",
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    "gemini-2.0-flash",
    "gemini-2.0-flash-lite",
    "gemini-flash-latest",
]

def _is_retryable(e: Exception) -> bool:
    """503/429/404 など別モデルで再試行すべきエラー"""
    msg = str(e)
    return (
        "503" in msg or "UNAVAILABLE" in msg
        or "429" in msg or "RESOURCE_EXHAUSTED" in msg
        or "404" in msg or "NOT_FOUND" in msg
    )


def _generate_with_fallback(api_key: str, contents: list) -> str:
    """候補モデルを順に試し、503/429 ならば次のモデルへフォールバックする。"""
    client = genai.Client(api_key=api_key)
    last_err: Exception | None = None
    for candidate in _CANDIDATE_MODELS:
        try:
            print(f"[Gemini] trying model: {candidate}")
            response = client.models.generate_content(model=candidate, contents=contents)
            print(f"[Gemini] success with model: {candidate}")
            return response.text.strip()
        except Exception as e:
            print(f"[Gemini] {candidate} failed: {e}")
            if _is_retryable(e):
                last_err = e
                continue
            raise
    raise RuntimeError(f"全モデルが利用不可です: {last_err}")


# ─── Gemini parse ─────────────────────────────────────────────────────────────

def _extract_json(text: str) -> List[Dict]:
    """Gemini 応答テキストから JSON を抽出してパース。"""
    if "```json" in text:
        text = text.split("```json")[1].split("```")[0].strip()
    elif "```" in text:
        for part in text.split("```"):
            if "{" in part and "[" in part:
                text = part.strip()
                break
    result = json.loads(text)
    if isinstance(result, dict):
        result = [result]
    return result


def parse_order_image(image: Image.Image, api_key: str) -> Optional[List[Dict]]:
    """
    Gemini API で注文書画像を解析。
    プロンプトは prompt_manager（Supabase 管理）から取得。
    フェイルセーフ: カスタムプロンプトで失敗/空結果なら内蔵デフォルトで自動再試行。

    Returns:
        解析結果リスト or None（失敗時）
    """
    known_stores = load_stores()
    item_normalization = load_items()

    store_list = "、".join(known_stores)
    norm_json = json.dumps(item_normalization, ensure_ascii=False, indent=2)

    # PIL Image → bytes で渡す
    import io as _io
    buf = _io.BytesIO()
    fmt = image.format or "JPEG"
    image.save(buf, format=fmt)
    image_bytes = buf.getvalue()
    mime_type = "image/jpeg" if fmt.upper() in ("JPEG", "JPG") else f"image/{fmt.lower()}"
    image_part = genai_types.Part.from_bytes(data=image_bytes, mime_type=mime_type)

    def _run(template: str) -> List[Dict]:
        prompt = render_prompt(template, store_list=store_list, item_normalization=norm_json)
        text = _generate_with_fallback(api_key, [image_part, prompt])
        return _extract_json(text)

    active = get_active_image_prompt()
    try:
        result = _run(active)
        if result:
            return result
        # 空結果: カスタムなら デフォルトで再試行
        if active is not DEFAULT_IMAGE_PROMPT:
            print("[parse_order_image] custom prompt returned empty, retrying with default")
            return _run(DEFAULT_IMAGE_PROMPT)
        return result
    except Exception as e:
        if active is not DEFAULT_IMAGE_PROMPT:
            print(f"[parse_order_image] custom prompt failed ({e}), retrying with default")
            return _run(DEFAULT_IMAGE_PROMPT)
        raise


# ─── Text parse (画像なし・テキスト本文から直接解析) ──────────────────────────

def parse_order_text(text_body: str, api_key: str) -> Optional[List[Dict]]:
    """
    テキスト本文をそのまま Gemini に渡して注文データを解析。
    転送メールなど、FAX 画像ではなくテキスト形式の注文書に対応。
    プロンプトは prompt_manager（Supabase 管理）から取得。
    フェイルセーフ: カスタムプロンプトで失敗/空結果なら内蔵デフォルトで自動再試行。
    """
    known_stores = load_stores()
    item_normalization = load_items()

    store_list = "、".join(known_stores)
    norm_json = json.dumps(item_normalization, ensure_ascii=False, indent=2)

    def _run(template: str) -> List[Dict]:
        prompt = render_prompt(
            template, store_list=store_list,
            item_normalization=norm_json, text_body=text_body,
        )
        text = _generate_with_fallback(api_key, [prompt])
        return _extract_json(text)

    active = get_active_text_prompt()
    try:
        result = _run(active)
        if result:
            return result
        if active is not DEFAULT_TEXT_PROMPT:
            print("[parse_order_text] custom prompt returned empty, retrying with default")
            return _run(DEFAULT_TEXT_PROMPT)
        return result
    except Exception as e:
        if active is not DEFAULT_TEXT_PROMPT:
            print(f"[parse_order_text] custom prompt failed ({e}), retrying with default")
            return _run(DEFAULT_TEXT_PROMPT)
        raise


# ─── Validation ──────────────────────────────────────────────────────────────

def validate_and_fix_order_data(
    order_data: List[Dict],
    auto_learn: bool = True,
) -> tuple[List[Dict], List[str], List[str]]:
    """
    AI 解析結果を検証・修正。
    v3 app.py の validate_and_fix_order_data() と完全同一ロジック。
    st.success/warning → 戻り値のリストに変換。

    Returns:
        (validated_data, learned_stores, warnings)
    """
    if not order_data:
        return [], [], []

    validated_data: List[Dict] = []
    warnings: List[str] = []
    learned_stores: List[str] = []
    learned_items: List[str] = []
    known_stores = load_stores()

    for i, entry in enumerate(order_data):
        store = entry.get("store", "").strip()
        item = entry.get("item", "").strip()

        # ── 店舗名 ─────────────────────────────────────────────────────
        validated_store: Optional[str] = None
        # 完全一致
        if store in known_stores:
            validated_store = store
        else:
            # 部分一致
            for ks in known_stores:
                if ks in store or store in ks:
                    validated_store = ks
                    break
        if not validated_store and store:
            if auto_learn:
                validated_store = auto_learn_store(store)
                if validated_store not in learned_stores:
                    learned_stores.append(validated_store)
            else:
                warnings.append(f"行{i+1}: 不明な店舗名「{store}」")

        # ── 品目名 ─────────────────────────────────────────────────────
        item_normalization = load_items()
        normalized_item: Optional[str] = None
        # Pass1: 完全一致優先（"ネギバラ" が "長ネギ"の"ねぎ"に誤マッチするのを防ぐ）
        for normalized, variants in item_normalization.items():
            if item in variants:
                normalized_item = normalized
                break
        # Pass2: 部分一致（最長マッチを優先して誤マッチを抑制）
        if not normalized_item:
            best_match: Optional[str] = None
            best_len = 0
            for normalized, variants in item_normalization.items():
                for v in variants:
                    if v in item and len(v) > best_len:
                        best_match = normalized
                        best_len = len(v)
            normalized_item = best_match
        if not normalized_item and item:
            if auto_learn:
                normalized_item = auto_learn_item(item)
                if normalized_item not in learned_items:
                    learned_items.append(normalized_item)
            else:
                warnings.append(f"行{i+1}: 品目名「{item}」を正規化できませんでした")

        # ── 数量 ────────────────────────────────────────────────────────
        # input_num がある場合（新プロンプト形式）は unit/boxes を上書きしない。
        # ocr.py の parse_verification が DB の unit_size を使って計算する。
        input_num_val = safe_int(entry.get("input_num", 0))
        unit = safe_int(entry.get("unit", 0))
        boxes = safe_int(entry.get("boxes", 0))
        remainder = safe_int(entry.get("remainder", 0))

        if unit == 0 and boxes == 0 and remainder == 0 and input_num_val == 0:
            warnings.append(f"行{i+1}: 数量が全て0 (店舗: {store}, 品目: {item})")

        spec_value = str((entry.get("spec") or "")).strip()

        # input_num がない旧形式のときのみ config_manager に unit を保存
        if unit > 0 and input_num_val == 0:
            add_unit_if_new(
                normalized_item or item, spec_value, validated_store or store, unit
            )

        row: Dict[str, Any] = {
            "store": validated_store or store,
            "item": normalized_item or item,
            "spec": spec_value,
            "unit": unit,
            "boxes": boxes,
            "remainder": remainder,
        }
        # input_num を保持（ocr.py の v3 計算ロジックで使用）
        if "input_num" in entry:
            row["input_num"] = safe_int(entry["input_num"])
        validated_data.append(row)

    return validated_data, learned_stores, warnings


# ─── Label builder ────────────────────────────────────────────────────────────

def generate_labels_from_data(order_data: List[Dict], shipment_date: str) -> List[Dict]:
    """
    解析データからラベルリストを生成。
    v3 app.py の generate_labels_from_data() と完全同一ロジック。

    【重要】
    - total_boxes = boxes + (1 if remainder > 0 else 0)
    - 通常箱: quantity="{unit}{unit_label}", is_fraction=False
    - 端数箱: quantity="{remainder}{unit_label}", is_fraction=True
    """
    from datetime import datetime as _dt

    labels = []
    dt = _dt.strptime(shipment_date, "%Y-%m-%d")
    shipment_date_display = f"{dt.month}月{dt.day}日"

    for entry in order_data:
        store = entry.get("store", "")
        item = entry.get("item", "")
        spec = entry.get("spec", "")
        unit = safe_int(entry.get("unit", 0))
        boxes = safe_int(entry.get("boxes", 0))
        remainder = safe_int(entry.get("remainder", 0))

        if unit == 0:
            continue

        # DBの unit_type を優先（納品書・出荷一覧表と単位を統一）。なければ推測ロジックで補完
        db_unit_type = entry.get("unit_type", "")
        unit_label = db_unit_type if db_unit_type else get_unit_label_for_item(item, spec)
        total_boxes = boxes + (1 if remainder > 0 else 0)

        # 通常箱
        for i in range(boxes):
            labels.append(
                {
                    "store": store,
                    "item": item,
                    "spec": spec,
                    "quantity": f"{unit}{unit_label}",
                    "sequence": f"{i+1}/{total_boxes}",
                    "is_fraction": False,
                    "shipment_date": shipment_date_display,
                    "unit": unit,
                    "boxes": boxes,
                    "remainder": remainder,
                }
            )

        # 端数箱
        if remainder > 0:
            labels.append(
                {
                    "store": store,
                    "item": item,
                    "spec": spec,
                    "quantity": f"{remainder}{unit_label}",
                    "sequence": f"{total_boxes}/{total_boxes}",
                    "is_fraction": True,
                    "shipment_date": shipment_date_display,
                    "unit": unit,
                    "boxes": boxes,
                    "remainder": remainder,
                }
            )

    return labels


def generate_summary_table(order_data: List[Dict]) -> List[Dict]:
    """
    出荷一覧表用データを生成。
    v3 app.py の generate_summary_table() と完全同一ロジック。
    """
    summary = []
    for entry in order_data:
        store = entry.get("store", "")
        item = entry.get("item", "")
        spec = entry.get("spec", "")
        boxes = safe_int(entry.get("boxes", 0))
        remainder = safe_int(entry.get("remainder", 0))
        unit = safe_int(entry.get("unit", 0))

        rem_box = 1 if remainder > 0 else 0
        total_packs = boxes + rem_box
        total_quantity = (unit * boxes) + remainder
        # DBの unit_type を優先。なければ item_settings.json のロジックで補完
        db_unit_type = entry.get("unit_type", "")
        unit_label = db_unit_type if db_unit_type else get_unit_label_for_item(item, spec)
        item_display = f"{item} {spec}".strip() if spec else item

        summary.append(
            {
                "store": store,
                "item": item,
                "spec": spec,
                "item_display": item_display,
                "boxes": boxes,
                "remainder": remainder,
                "rem_box": rem_box,
                "total_packs": total_packs,
                "total_quantity": total_quantity,
                "unit": unit,
                "unit_label": unit_label,
            }
        )
    return summary


def modify_order_data_with_notes(current_lines: List[Dict], notes: str, api_key: str) -> List[Dict]:
    """
    既存の注文明細リストを、ユーザーのテキスト指示に基づいて Gemini API で修正・更新します。
    """
    prompt = f"""
ユーザーから注文データの修正指示がありました。
現在の注文明細データ（JSON）と、ユーザーからの修正指示（自然言語）を受け取り、指示通りに修正した新しい明細データ（JSON）を出力してください。

【現在の注文明細データ】
{json.dumps(current_lines, ensure_ascii=False, indent=2)}

【ユーザーからの修正指示】
{notes}

【指示】
- 指示に従って数量（boxes: 箱数, remainder: バラ数）を変更してください。
- 該当する商品や店舗が明示的に指定されている場合はそれを対象にしてください。
- 「1行目」「2番目」のように番号で指示されている場合は、現在のデータのインデックス（1から始まるインデックス）に対応させて適切に解釈し、修正してください。
- 数量の増減（例: 「+5箱」「3箱増やす」「2減らす」など）が指示されている場合は、現在の値にその数を加算または減算してください。
- 元のデータにある店舗名（store）や品名（item）、規格（spec）、入数（unit）などは、明示的な変更指示がない限りそのまま維持してください。
- 出力は必ず以下の形式のJSON配列のみとし、余計な説明やマークダウンタグ（```jsonなど）は含めないでください。

【出力フォーマット】
[
  {{
    "store": "店舗名",
    "item": "品名",
    "spec": "規格",
    "unit": 10,
    "boxes": 12,
    "remainder": 0
  }},
  ...
]
"""
    text = _generate_with_fallback(api_key, [prompt])
    
    # JSON 抽出
    if "```json" in text:
        text = text.split("```json")[1].split("```")[0].strip()
    elif "```" in text:
        for part in text.split("```"):
            if "{" in part and "[" in part:
                text = part.strip()
                break

    try:
        result = json.loads(text)
        if isinstance(result, dict):
            result = [result]
        return result
    except Exception as e:
        print(f"[modify_order_data_with_notes] JSON parse error: {e}. Raw text: {text}")
        raise ValueError(f"AIの応答をJSONとして解析できませんでした: {e}")

