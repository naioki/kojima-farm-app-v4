import urllib.request
import json
import ssl

def register_commands():
    print("--- Discord スラッシュコマンド登録ツール ---")
    print("このスクリプトは、Discord に「/印刷」コマンドを登録します。")
    print("※設定に必要な情報は、Discord Developer Portal (https://discord.com/developers/applications) から取得してください。\n")
    
    app_id = input("1. Application ID (クライアントID) を入力してください: ").strip()
    bot_token = input("2. Bot Token (ボットのトークン) を入力してください: ").strip()
    
    if not app_id or not bot_token:
        print("エラー: Application ID または Bot Token が空欄です。")
        return

    url = f"https://discord.com/api/v10/applications/{app_id}/commands"
    
    commands = [
        {
            "name": "印刷",
            "description": "出荷日の注文メールを読み込んで印刷確認プレビューを表示します",
            "options": [
                {
                    "type": 3, # STRING type
                    "name": "日付",
                    "description": "出荷日を指定（例：今日、明日、昨日、1、2、3、6/5 など）",
                    "required": False
                }
            ]
        },
        {
            "name": "order-print",
            "description": "Fetch and print order labels for a specific shipping date",
            "options": [
                {
                    "type": 3, # STRING type
                    "name": "date",
                    "description": "Shipping date (e.g. today, tomorrow, yesterday, 1, 2, 3, 06-05)",
                    "required": False
                }
            ]
        }
    ]
    
    req = urllib.request.Request(
        url,
        data=json.dumps(commands).encode("utf-8"),
        headers={
            "Authorization": f"Bot {bot_token}",
            "Content-Type": "application/json"
        },
        method="PUT"
    )
    
    # SSL証明書の検証をスキップするコンテキストを作成 (urllib 対策)
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE

    print("\nDiscord API にリクエスト送信中...")
    try:
        with urllib.request.urlopen(req, context=ctx) as response:
            res_data = response.read().decode("utf-8")
            print("✅ 登録成功！")
            print("コマンドが正常に登録されました。Discord を再起動（または開き直し）すると、チャット欄で「/印刷」が使えるようになります。")
    except Exception as e:
        print("❌ 登録失敗。エラーが発生しました:")
        print(e)
        if hasattr(e, "read"):
            print("詳細:", e.read().decode("utf-8"))

if __name__ == "__main__":
    register_commands()
