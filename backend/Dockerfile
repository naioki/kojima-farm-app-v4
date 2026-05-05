FROM python:3.11-slim

WORKDIR /app

# システム依存（ReportLab / Pillow ビルド用）
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libffi-dev \
    && rm -rf /var/lib/apt/lists/*

# 依存インストール
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# ソースコピー
COPY . .

# フォントが assets/ に存在することを確認
RUN test -f assets/ipaexg.ttf || (echo "ERROR: assets/ipaexg.ttf not found" && exit 1)

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
