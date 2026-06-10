#!/bin/bash
# 小島農園 自動印刷エージェント セットアップスクリプト
# 使い方: bash setup_print_agent.sh

set -e

INSTALL_DIR="$HOME/kojima-print-agent"
echo "=== 小島農園 自動印刷エージェント セットアップ ==="
echo "インストール先: $INSTALL_DIR"

# ディレクトリ作成
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

# print_agent.py をダウンロード
echo ">>> print_agent.py をダウンロード中..."
curl -fsSL "https://raw.githubusercontent.com/naioki/kojima-farm-app-v4/feature/chat-print-automation/backend/print_agent.py" -o print_agent.py

# .env ファイルを作成
echo ">>> 環境変数ファイルを作成中..."
cat > .env << 'EOF'
SUPABASE_URL=https://hynedtzwxuinruxsxvlm.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh5bmVkdHp3eHVpbnJ1eHN4dmxtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Nzc5MzIyMCwiZXhwIjoyMDkzMzY5MjIwfQ.UUrzDD45K6LHYpkoSbNkcA163wZll7eh4ytpTbkv2ng
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/1511999520807063572/Uu_5A4bjW_ckIgEM6kcldsANME1J_Q-SH43M0_Ow14QmrJggdain5GHRn87M_KG6opAc
POLL_INTERVAL=15
EOF

# Python と pip の確認
echo ">>> Python を確認中..."
if ! command -v python3 &> /dev/null; then
    echo "Python3 が見つかりません。インストール中..."
    sudo apt-get update -q && sudo apt-get install -y python3 python3-pip
fi

# 依存パッケージをインストール
echo ">>> 依存パッケージをインストール中..."
pip3 install python-dotenv --quiet

# systemd サービスを登録（常時起動）
echo ">>> systemd サービスを登録中..."
PYTHON_PATH=$(which python3)
SERVICE_FILE="/etc/systemd/system/kojima-print-agent.service"

sudo tee "$SERVICE_FILE" > /dev/null << EOF
[Unit]
Description=Kojima Farm Auto Print Agent
After=network.target

[Service]
WorkingDirectory=$INSTALL_DIR
ExecStart=$PYTHON_PATH $INSTALL_DIR/print_agent.py
Restart=always
RestartSec=10
StandardOutput=append:$INSTALL_DIR/print_agent.log
StandardError=append:$INSTALL_DIR/print_agent.log

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable kojima-print-agent
sudo systemctl start kojima-print-agent

echo ""
echo "=== セットアップ完了 ==="
echo "ステータス確認: sudo systemctl status kojima-print-agent"
echo "ログ確認:       tail -f $INSTALL_DIR/print_agent.log"
echo "停止:           sudo systemctl stop kojima-print-agent"
