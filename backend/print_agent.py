"""
現場PC用：自動印刷監視エージェント (print_agent.py)
このスクリプトを事務所の常時起動PC（Windows）で動かしてください。
"""
from __future__ import annotations

import os
import time
import tempfile
import subprocess
import urllib.request
import json

# ================= 配置設定 =================
# Supabase の接続情報（ダッシュボードの .env.local と同じ値を入れてください）
SUPABASE_URL = "https://hynedtzwxuinruxsxvlm.supabase.co"
SUPABASE_SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh5bmVkdHp3eHVpbnJ1eHN4dmxtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Nzc5MzIyMCwiZXhwIjoyMDkzMzY5MjIwfQ.UUrzDD45K6LHYpkoSbNkcA163wZll7eh4ytpTbkv2ng"

# 監視周期（秒）
POLL_INTERVAL = 15
# ==========================================


def _supabase_request(method: str, path: str, data: dict = None) -> list | dict | None:
    """Supabase REST API を直接呼び出す簡易クライアント"""
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
        print(f"[Supabase Request Error] {e}")
        return None


def print_pdf_windows(pdf_path: str) -> bool:
    """Windows の標準 PowerShell を呼び出して PDF をサイレント印刷"""
    print(f"[{datetime_now()}] Printing PDF: {pdf_path}")
    
    # PowerShell コマンドで PDF を印刷（デフォルトプリンター宛て）
    # Acrobat Reader 等の追加ソフト不要で Windows 標準の印刷フローを使用可能
    cmd = [
        "powershell",
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-Command",
        f"Start-Process -FilePath '{pdf_path}' -Verb Print -WindowStyle Hidden -PassThru | Out-Null"
    ]
    
    try:
        # 印刷プロセスを開始
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        if result.returncode == 0:
            print(f"[{datetime_now()}] Print command sent to system successfully.")
            return True
        else:
            print(f"[{datetime_now()}] Print failed: {result.stderr}")
            return False
    except Exception as e:
        print(f"[{datetime_now()}] Print exception: {e}")
        return False


def datetime_now() -> str:
    return time.strftime("%Y-%m-%d %H:%M:%S")


def main():
    print("=" * 60)
    print(f"[{datetime_now()}] 小島農園 自動印刷監視エージェント 起動中...")
    print(f"接続先: {SUPABASE_URL}")
    print(f"監視周期: {POLL_INTERVAL}秒")
    print("=" * 60)

    while True:
        try:
            # 1. 印刷キュー（pending）のジョブを取得
            # 最新の pending を 1 件取得して順に処理
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
            print(f"\n[{datetime_now()}] Found pending job: {job_id[:8]}... (URL: {pdf_url[:40]}...)")

            # 2. ステータスを 'processing' に更新（競合防止）
            _supabase_request("PATCH", f"/print_jobs?id=eq.{job_id}", {"status": "processing"})

            # 3. PDFのダウンロード
            with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp_file:
                tmp_path = tmp_file.name

            try:
                print(f"[{datetime_now()}] Downloading PDF...")
                urllib.request.urlretrieve(pdf_url, tmp_path)
                
                # 4. 印刷実行
                success = print_pdf_windows(tmp_path)
                
                if success:
                    # 5. ステータスを 'success' に更新
                    _supabase_request(
                        "PATCH", 
                        f"/print_jobs?id=eq.{job_id}", 
                        {"status": "success"}
                    )
                    print(f"[{datetime_now()}] Job {job_id[:8]}... status updated to 'success'.")
                else:
                    raise Exception("OSの印刷処理がエラーを返しました")

            except Exception as e:
                err_msg = str(e)
                print(f"[{datetime_now()}] Error processing job: {err_msg}")
                # 失敗ステータスとエラーメッセージをDBに書き戻す
                _supabase_request(
                    "PATCH", 
                    f"/print_jobs?id=eq.{job_id}", 
                    {"status": "failed", "error_message": err_msg}
                )

            finally:
                if os.path.exists(tmp_path):
                    try:
                        os.unlink(tmp_path)
                    except Exception:
                        pass

        except KeyboardInterrupt:
            print(f"\n[{datetime_now()}] エージェントを停止しました。")
            break
        except Exception as e:
            print(f"[{datetime_now()}] 予期しないループエラー (30秒待機後に再開): {e}")
            time.sleep(30)


if __name__ == "__main__":
    main()
