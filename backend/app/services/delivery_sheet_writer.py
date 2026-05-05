"""
納品データ（スプレッドシート）への追記

変換済みの納品データ行を、既存の「納品データ」シートに追記する。
認証は .streamlit/secrets の GCP サービスアカウントまたは環境変数 GOOGLE_APPLICATION_CREDENTIALS の JSON パスで行う。
"""
from __future__ import annotations

from typing import Any, List, Dict, Optional, Tuple
import os
import re

# 納品データシートの列順（ヘッダーと行の並びを統一）
DELIVERY_SHEET_COLUMNS = [
    "納品ID",
    "納品日付",
    "農家",
    "納品先",
    "請求先",
    "品目",
    "持込日付",
    "規格",
    "納品単価",
    "数量",
    "納品金額",
    "税率",
    "チェック",
]

# 1リクエストあたりの最大行数（API制限・タイムアウト対策）
_APPEND_BATCH_SIZE = 500

# スプレッドシートIDの形式: 英数字とハイフン/アンダースコア（実運用では40文字前後）
_SPREADSHEET_ID_PATTERN = re.compile(r"^[a-zA-Z0-9_-]+$")


def _normalize_cell_value(v: Any) -> str | int | float:
    """セルに書き込む値を API が受け付ける型に正規化。"""
    if v is None:
        return ""
    if isinstance(v, (str, int, float)):
        return v
    if isinstance(v, bool):
        return str(v).lower()
    return str(v)


def _get_credentials(st_secrets: Any = None) -> Any:
    """st.secrets または環境変数から Google 認証情報を取得し、gspread 用の credentials を返す。"""
    try:
        from google.oauth2.service_account import Credentials
    except ImportError:
        return None
    keyfile = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    if keyfile and os.path.isfile(keyfile):
        try:
            return Credentials.from_service_account_file(
                keyfile,
                scopes=["https://www.googleapis.com/auth/spreadsheets"],
            )
        except (OSError, ValueError):
            pass
    if st_secrets is not None:
        try:
            gcp = getattr(st_secrets, "gcp", None)
            if gcp is None and hasattr(st_secrets, "get"):
                gcp = st_secrets.get("gcp")
            if gcp is not None:
                info = dict(gcp) if isinstance(gcp, dict) else dict(getattr(gcp, "_raw", gcp))
                if info.get("private_key") and info.get("client_email"):
                    return Credentials.from_service_account_info(
                        info,
                        scopes=["https://www.googleapis.com/auth/spreadsheets"],
                    )
        except (TypeError, ValueError, KeyError):
            pass
    return None


def _validate_spreadsheet_id(sid: str) -> bool:
    """スプレッドシートIDが有効な形式か。厳密でない簡易チェック。"""
    s = (sid or "").strip()
    if len(s) < 20:  # 実運用のIDは40文字前後
        return False
    return bool(_SPREADSHEET_ID_PATTERN.match(s))


def append_delivery_rows(
    spreadsheet_id: str,
    rows: List[Dict[str, Any]],
    sheet_name: str = "納品データ",
    credentials=None,
    st_secrets=None,
) -> Tuple[bool, str]:
    """
    変換済みの納品データ行を指定スプレッドシートの「納品データ」シートに追記する。

    Args:
        spreadsheet_id: スプレッドシート ID（URL の /d/ と /edit の間の文字列）
        rows: delivery_converter.v2_result_to_delivery_rows の戻り値のような辞書のリスト
        sheet_name: シート名。既定は "納品データ"
        credentials: google.oauth2.service_account.Credentials。省略時は st_secrets または環境変数から取得
        st_secrets: Streamlit の st.secrets オブジェクト（credentials 未指定時のみ使用）

    Returns:
        (成功したか, メッセージ)
    """
    if not rows or not isinstance(rows, list):
        return True, "追記する行がありません。"
    sid = (spreadsheet_id or "").strip()
    if not sid:
        return False, "スプレッドシートIDが指定されていません。"
    if not _validate_spreadsheet_id(sid):
        return False, "スプレッドシートIDの形式が正しくありません。URLの /d/ と /edit の間の文字列をそのまま入力してください。"
    sheet_name_s = (sheet_name or "納品データ").strip() or "納品データ"
    creds = credentials or _get_credentials(st_secrets)
    if creds is None:
        return False, "Google スプレッドシート用の認証が設定されていません。.streamlit/secrets.toml の [gcp] または GOOGLE_APPLICATION_CREDENTIALS を設定してください。"
    try:
        import gspread
    except ImportError:
        return False, "gspread がインストールされていません。pip install gspread google-auth を実行してください。"
    try:
        client = gspread.authorize(creds)
        workbook = client.open_by_key(sid)
        sheet = workbook.worksheet(sheet_name_s)
    except Exception as e:
        return False, f"スプレッドシートの取得に失敗しました: {str(e).strip() or '不明なエラー'}"

    data = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        data.append([_normalize_cell_value(row.get(col, "")) for col in DELIVERY_SHEET_COLUMNS])
    if not data:
        return True, "追記する有効な行がありません。"
    try:
        for i in range(0, len(data), _APPEND_BATCH_SIZE):
            chunk = data[i : i + _APPEND_BATCH_SIZE]
            sheet.append_rows(chunk, value_input_option="USER_ENTERED")
    except Exception as e:
        return False, f"追記に失敗しました: {e}"
    return True, f"{len(data)} 行を追記しました。"


def is_sheet_configured(st_secrets=None) -> bool:
    """納品データシートへの追記が可能な認証が設定されているかどうか。"""
    return _get_credentials(st_secrets) is not None
