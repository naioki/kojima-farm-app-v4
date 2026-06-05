"""
Kojima Farm DXプラットフォーム - オンプレミス自動印刷エージェント (print_agent.py)
このスクリプトは、現場の常時起動 Ubuntu ノートPCで systemd サービスとして稼働します。
"""
from __future__ import annotations

import os
import sys
import time
import logging
import tempfile
import subprocess
import urllib.request
import json
import platform

# タイムスタンプ付きの標準ロギング設定
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler("print_agent.log", encoding="utf-8")
    ]
)

# python-dotenv がインストールされている場合は環境変数を読み込む
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    logging.warning("python-dotenv is not installed. Relying on system environment variables.")

# ================= 環境変数からの設定取得 =================
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
DISCORD_WEBHOOK_URL = os.environ.get("DISCORD_WEBHOOK_URL", "")

try:
    POLL_INTERVAL = int(os.environ.get("POLL_INTERVAL", "15"))
except ValueError:
    POLL_INTERVAL = 15
# =======================================================


def send_discord_alert(message: str) -> None:
    """重大なエラー発生時に Discord Webhook 宛てに即座にアラートを送信"""
    if not DISCORD_WEBHOOK_URL:
        logging.warning("DISCORD_WEBHOOK_URL is not set. Skipping Discord alert.")
        return

    payload = {
        "content": f"🚨 **【自動印刷エージェント異常検知】**\n{message}"
    }
    req_data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        DISCORD_WEBHOOK_URL,
        data=req_data,
        headers={"Content-Type": "application/json"},
        method="POST"
    )

    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            if response.status not in (200, 204):
                logging.error(f"Discord API returned status {response.status}")
    except Exception as e:
        logging.error(f"Failed to send Discord alert: {e}")


def _supabase_request(method: str, path: str, data: dict = None) -> list | dict | None:
    """Supabase REST API を直接呼び出す簡易 HTTP クライアント"""
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        raise ValueError("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not configured.")

    url = f"{SUPABASE_URL}/rest/v1{path}"
    headers = {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation"
    }

    req_data = json.dumps(data).encode("utf-8") if data else None
    req = urllib.request.Request(url, data=req_data, headers=headers, method=method)

    try:
        with urllib.request.urlopen(req, timeout=15) as response:
            res_body = response.read().decode("utf-8")
            return json.loads(res_body) if res_body else None
    except Exception as e:
        logging.error(f"Supabase HTTP Request failed ({method} {path}): {e}")
        raise


def print_pdf(pdf_path: str) -> bool:
    """
    OSを自動判別し、適切なサイレント印刷コマンドを実行。
    Linux環境では CUPS の lp コマンドを使用し、A4用紙サイズかつDraft画質で印刷コストを最小化。
    """
    system_name = platform.system()
    logging.info(f"OS detected: {system_name}. Starting print job for: {pdf_path}")
    
    if system_name == "Windows":
        # Windows の標準 PowerShell によるサイレント印刷
        cmd = [
            "powershell",
            "-NoProfile",
            "-ExecutionPolicy", "Bypass",
            "-Command",
            f"Start-Process -FilePath '{pdf_path}' -Verb Print -WindowStyle Hidden -PassThru | Out-Null"
        ]
    elif system_name == "Linux" or system_name == "Darwin":
        # Linux (Ubuntu) の lp コマンドによるサイレント印刷
        # media=A4: A4サイズ指定
        # print-quality=3: ドラフト画質 (Draft Quality / 省インクモード)
        cmd = [
            "lp",
            "-o", "media=A4",
            "-o", "print-quality=3",
            pdf_path
        ]
    else:
        logging.error(f"Unsupported OS for printing: {system_name}")
        return False
    
    try:
        # 印刷プロセスをタイムアウト30秒で実行
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        if result.returncode == 0:
            logging.info("Print command completed successfully and sent to OS spool.")
            return True
        else:
            stderr_msg = result.stderr or result.stdout
            logging.error(f"OS print command returned error code {result.returncode}. Msg: {stderr_msg}")
            return False
    except subprocess.TimeoutExpired:
        logging.error("OS print command execution timed out (30s limit exceeded).")
        return False
    except Exception as e:
        logging.error(f"Exception during OS print command execution: {e}")
        return False


def main():
    logging.info("=" * 60)
    logging.info("小島農園 自動印刷監視エージェント 起動中...")
    logging.info(f"Target DB: {SUPABASE_URL}")
    logging.info(f"Poll Interval: {POLL_INTERVAL}s")
    logging.info("=" * 60)

    # 起動時の設定パラメータ妥当性チェック
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        err_msg = "起動エラー: SUPABASE_URL または SUPABASE_SERVICE_ROLE_KEY が設定されていません。"
        logging.critical(err_msg)
        send_discord_alert(err_msg)
        sys.exit(1)

    while True:
        try:
            # 1. 印刷キュー（pending）のジョブを取得
            # 最も古い pending ジョブを 1 件取得
            jobs = _supabase_request(
                "GET", 
                "/print_jobs?status=eq.pending&order=created_at.asc&limit=1"
            )
            
            if not jobs:
                time.sleep(POLL_INTERVAL)
                continue

            job = jobs[0]
            job_id = job["id"]
            pdf_url = job["pdf_url"]
            logging.info(f"Found pending print job: {job_id} (URL: {pdf_url[:50]}...)")

            # 2. ステータスを 'processing' に更新し、二重実行を抑止
            _supabase_request("PATCH", f"/print_jobs?id=eq.{job_id}", {"status": "processing"})

            # 3. PDFファイルを一時ディレクトリに安全にダウンロード
            tmp_path = None
            try:
                with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp_file:
                    tmp_path = tmp_file.name

                logging.info(f"Downloading PDF to temporary file: {tmp_path}...")
                urllib.request.urlretrieve(pdf_url, tmp_path)
                
                # 4. 印刷コマンドの実行
                success = print_pdf(tmp_path)
                
                if success:
                    # 5. 印刷成功時はステータスを 'printed' に更新
                    _supabase_request(
                        "PATCH", 
                        f"/print_jobs?id=eq.{job_id}", 
                        {"status": "printed"}
                    )
                    logging.info(f"Successfully processed and printed job: {job_id}")
                else:
                    raise RuntimeError("OSの印刷プロセスが失敗しました。")

            except Exception as inner_error:
                err_msg = str(inner_error)
                logging.error(f"Error occurred during job processing ({job_id}): {err_msg}")
                
                # 失敗ステータスとエラーメッセージをDBに書き込み
                _supabase_request(
                    "PATCH", 
                    f"/print_jobs?id=eq.{job_id}", 
                    {"status": "failed", "error_message": err_msg}
                )
                
                # Discord アラート送信
                send_discord_alert(
                    f"**印刷ジョブ処理失敗**\n"
                    f"・ジョブID: `{job_id}`\n"
                    f"・エラー内容: `{err_msg}`\n"
                    f"・PDF URL: <{pdf_url}>"
                )

            finally:
                # 一時ファイル（PDF）の確実な削除
                if tmp_path and os.path.exists(tmp_path):
                    try:
                        os.unlink(tmp_path)
                        logging.info("Temporary PDF file successfully cleaned up.")
                    except Exception as clean_err:
                        logging.error(f"Failed to delete temporary PDF file '{tmp_path}': {clean_err}")

        except KeyboardInterrupt:
            logging.info("Agent process terminated manually by user (KeyboardInterrupt).")
            break
        except Exception as outer_error:
            # データベース接続エラーやネットワーク切断などの致命的な例外
            err_msg = f"印刷ポーリングループ内で致命的な例外が発生しました: {outer_error}"
            logging.error(err_msg)
            
            # Discordへ通知し、ループの破綻を防ぐために30秒待機してから再開
            send_discord_alert(err_msg)
            logging.info("Retrying in 30 seconds...")
            time.sleep(30)


if __name__ == "__main__":
    main()
