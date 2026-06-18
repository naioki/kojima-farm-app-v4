"""
AIプロンプト管理モジュール

メール/画像解析用のプロンプトを Supabase (prompt_config) で管理する。
フェイルセーフ設計:
  - is_custom_enabled が False、またはカスタムプロンプトが未設定 → 内蔵デフォルトを使用
  - 必須プレースホルダが欠落しているカスタムプロンプトは無効とみなしデフォルトへフォールバック
  - DB 取得に失敗しても常にデフォルトで動作する（業務停止を防ぐ）

プレースホルダは JSON の波括弧と衝突しないよう [[...]] 形式を採用:
  [[STORE_LIST]]          … 店舗名リスト
  [[ITEM_NORMALIZATION]]  … 品目正規化マップ(JSON)
  [[TEXT_BODY]]           … 解析対象のメール本文（テキスト解析のみ）
"""
from __future__ import annotations

import os
from typing import Optional, Tuple

# ─── 必須プレースホルダ ────────────────────────────────────────────────
REQUIRED_IMAGE_PLACEHOLDERS = ["[[STORE_LIST]]", "[[ITEM_NORMALIZATION]]"]
REQUIRED_TEXT_PLACEHOLDERS = ["[[STORE_LIST]]", "[[ITEM_NORMALIZATION]]", "[[TEXT_BODY]]"]

# ─── 内蔵デフォルトプロンプト（フェイルセーフの最後の砦・編集不可） ────────
DEFAULT_IMAGE_PROMPT = """
画像を解析し、以下の厳密なルールに従ってJSONで返してください。

【店舗名リスト（参考）】
[[STORE_LIST]]
※上記リストにない店舗名も読み取ってください。

【品目名の正規化ルール】
[[ITEM_NORMALIZATION]]

【重要ルール】
1. 店舗名の後に「:」または改行がある場合、その後の行は全てその店舗の注文です
2. 品目名がない行（例：「50×1」）は、直前の品目の続きとして処理してください
3. 「/」で区切られた複数の注文は、同じ店舗・同じ品目として統合してください
4. 「胡瓜バラ」「ネギバラ」と「胡瓜3本」「ネギ2本」は**別の品目**として扱ってください
5. 「ネギバラ」は item="長ねぎバラ"、spec="" で出力してください（長ネギ2本と混同しない）
6. 「胡瓜バラ50本」は **100本換算** に変換してください：
   - item="胡瓜バラ(100本)"、spec=""、input_num=N×50（例：×15なら750）

【最重要：input_num には注文書の「×」の直後の数字をそのまま入れてください】
- 箱数への変換・割り算は不要です。システムが自動計算します。
- unit=0、boxes=0、remainder=0 で出力してください。
- 例：「胡瓜3本×400」→ {"item":"胡瓜","spec":"3本","input_num":400,"unit":0,"boxes":0,"remainder":0}
- 例：「ネギ2本×60」→ {"item":"長ネギ","spec":"2本","input_num":60,"unit":0,"boxes":0,"remainder":0}
- 例：「ネギバラ×250」→ {"item":"長ねぎバラ","spec":"","input_num":250,"unit":0,"boxes":0,"remainder":0}
- 例：「胡瓜バラ50本×15」→ {"item":"胡瓜バラ(100本)","spec":"","input_num":750,"unit":0,"boxes":0,"remainder":0}
- 例：「春菊×30」→ {"item":"春菊","spec":"","input_num":30,"unit":0,"boxes":0,"remainder":0}

【出力JSON形式】
[{"store":"店舗名","item":"品目名","spec":"規格","input_num":数字,"unit":0,"boxes":0,"remainder":0}]

必ず全ての店舗と品目を漏れなく読み取ってください。
"""

DEFAULT_TEXT_PROMPT = """
以下のメールテキストから注文データを抽出し、厳密なルールに従ってJSONで返してください。

【店舗名リスト（参考）】
[[STORE_LIST]]
※上記リストにない店舗名も読み取ってください。

【品目名の正規化ルール】
[[ITEM_NORMALIZATION]]

【重要ルール】
1. 店舗名の後に「:」または改行がある場合、その後の行は全てその店舗の注文です
2. 「/」で区切られた複数の注文は、同じ店舗・同じ品目として統合してください
3. 「胡瓜バラ」「ネギバラ」と「胡瓜3本」「ネギ2本」は**別の品目**として扱ってください
4. 「ネギバラ」は item="長ねぎバラ"、spec="" で出力してください（長ネギ2本と混同しない）
5. 「胡瓜バラ50本」は **100本換算** に変換してください：
   - item="胡瓜バラ(100本)"、spec=""、input_num=N×50（例：×15なら750）

【最重要：input_num には注文書の「×」の直後の数字をそのまま入れてください】
- 箱数への変換・割り算は不要です。システムが自動計算します。
- unit=0、boxes=0、remainder=0 で出力してください。
- 例：「胡瓜3本×400」→ {"item":"胡瓜","spec":"3本","input_num":400,"unit":0,"boxes":0,"remainder":0}
- 例：「ネギ2本×60」→ {"item":"長ネギ","spec":"2本","input_num":60,"unit":0,"boxes":0,"remainder":0}
- 例：「ネギバラ×250」→ {"item":"長ねぎバラ","spec":"","input_num":250,"unit":0,"boxes":0,"remainder":0}
- 例：「胡瓜バラ50本×15」→ {"item":"胡瓜バラ(100本)","spec":"","input_num":750,"unit":0,"boxes":0,"remainder":0}
- 例：「春菊×30」→ {"item":"春菊","spec":"","input_num":30,"unit":0,"boxes":0,"remainder":0}

【出力JSON形式】
[{"store":"店舗名","item":"品目名","spec":"規格","input_num":数字,"unit":0,"boxes":0,"remainder":0}]

必ず全ての店舗と品目を漏れなく読み取ってください。

【注文メールテキスト】
[[TEXT_BODY]]
"""

_DEFAULT_TENANT_ID = os.environ.get(
    "DEFAULT_TENANT_ID", "00000000-0000-0000-0000-000000000001"
)


# ─── バリデーション ────────────────────────────────────────────────────
def validate_prompt(prompt: str, kind: str) -> list[str]:
    """必須プレースホルダの欠落をチェック。欠落しているトークンのリストを返す（空=OK）。"""
    required = REQUIRED_IMAGE_PLACEHOLDERS if kind == "image" else REQUIRED_TEXT_PLACEHOLDERS
    if not prompt or not prompt.strip():
        return required
    return [ph for ph in required if ph not in prompt]


# ─── アクティブプロンプト取得（フェイルセーフ込み） ──────────────────────
def _fetch_config() -> Optional[dict]:
    """Supabase から prompt_config を取得。失敗時 None。"""
    try:
        from app.services.supabase_client import get_supabase
        sb = get_supabase()
        rows = (
            sb.table("prompt_config")
            .select("image_prompt, text_prompt, is_custom_enabled")
            .eq("tenant_id", _DEFAULT_TENANT_ID)
            .limit(1)
            .execute()
        )
        if rows.data:
            return rows.data[0]
    except Exception as e:
        print(f"[prompt_manager] config fetch failed, using default: {e}")
    return None


def get_active_image_prompt() -> str:
    """画像解析用のアクティブなプロンプトテンプレートを返す（フェイルセーフ）。"""
    cfg = _fetch_config()
    if cfg and cfg.get("is_custom_enabled") and cfg.get("image_prompt"):
        custom = cfg["image_prompt"]
        if not validate_prompt(custom, "image"):
            return custom
        print("[prompt_manager] custom image_prompt invalid (missing placeholders), using default")
    return DEFAULT_IMAGE_PROMPT


def get_active_text_prompt() -> str:
    """テキスト解析用のアクティブなプロンプトテンプレートを返す（フェイルセーフ）。"""
    cfg = _fetch_config()
    if cfg and cfg.get("is_custom_enabled") and cfg.get("text_prompt"):
        custom = cfg["text_prompt"]
        if not validate_prompt(custom, "text"):
            return custom
        print("[prompt_manager] custom text_prompt invalid (missing placeholders), using default")
    return DEFAULT_TEXT_PROMPT


# ─── テンプレート展開 ──────────────────────────────────────────────────
def render_prompt(template: str, *, store_list: str, item_normalization: str,
                  text_body: str = "") -> str:
    """プレースホルダを実値に置換。"""
    return (
        template
        .replace("[[STORE_LIST]]", store_list)
        .replace("[[ITEM_NORMALIZATION]]", item_normalization)
        .replace("[[TEXT_BODY]]", text_body)
    )
