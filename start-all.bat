@echo off
echo Starting AI Voice Assistant - All Services
echo ============================================
echo.

echo [1/3] Starting Backend FastAPI Server...
start "Backend API" cmd /k "cd backend && venv\Scripts\activate && python -m app.main"
timeout /t 3 /nobreak >nul

echo [2/3] Starting LiveKit Agent Worker...
start "LiveKit Agent" cmd /k "cd backend && venv\Scripts\activate && python app\agent.py dev"
timeout /t 3 /nobreak >nul

echo [3/3] Starting Frontend Dev Server...
start "Frontend" cmd /k "cd frontend && npm run dev"
timeout /t 3 /nobreak >nul

echo.
echo ============================================
echo All services started in separate windows!
echo - Backend API: http://localhost:8000
echo - Frontend: http://localhost:5173
echo - LiveKit Agent: Running
echo ============================================
echo.
echo Press any key to close this window (services will continue running)...
pause >nul
