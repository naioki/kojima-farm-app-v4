# バックエンド開発サーバー起動（Windows PowerShell）

# .env.local を読み込む
if (Test-Path .env.local) {
    Get-Content .env.local | Where-Object { $_ -notmatch '^#' -and $_ -match '=' } | ForEach-Object {
        $k, $v = $_ -split '=', 2
        [System.Environment]::SetEnvironmentVariable($k.Trim(), $v.Trim(), 'Process')
    }
}

uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
