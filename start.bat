@echo off
start /min "FastAPI Backend" cmd /k "cd /d C:\kojima-farm-app-v4\backend && python -m uvicorn app.main:app --reload --port 8000"
start /min "Next.js Frontend" cmd /k "cd /d C:\kojima-farm-app-v4 && npm run dev"
timeout /t 6 /nobreak >nul
start chrome http://localhost:3000
