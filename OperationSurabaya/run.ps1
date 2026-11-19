# ==========================================
# OPERATION: SURABAYA - Backend Runner
# Jalankan: .\run.ps1 di PowerShell
# ==========================================

$VENV_PYTHON  = "$PSScriptRoot\.venv\Scripts\python.exe"

# Pindah ke root project (direktori script ini)
Set-Location $PSScriptRoot

Write-Host "======================================" -ForegroundColor Cyan
Write-Host "  OPERATION: SURABAYA - Backend API  " -ForegroundColor Cyan
Write-Host "======================================" -ForegroundColor Cyan
Write-Host ""

# Verifikasi venv
if (-not (Test-Path $VENV_PYTHON)) {
    Write-Host "[ERROR] .venv tidak ditemukan:" -ForegroundColor Red
    Write-Host "  $VENV_PYTHON" -ForegroundColor Red
    Write-Host ""
    Write-Host "Pastikan .venv sudah dibuat di root project:" -ForegroundColor Yellow
    Write-Host "  python -m venv .venv" -ForegroundColor Yellow
    Write-Host "  .venv\Scripts\pip install -r requirements.txt" -ForegroundColor Yellow
    pause
    exit 1
}

# Cek dependensi
Write-Host "[CHECK] Memeriksa dependensi face_recognition & OpenCV..." -ForegroundColor Yellow
$check = & $VENV_PYTHON -c "import cv2, face_recognition, fastapi; print('[OK] Semua dependensi tersedia.')" 2>&1
Write-Host $check

Write-Host ""
Write-Host "[START] Menjalankan FastAPI server..." -ForegroundColor Green
Write-Host "        URL  : http://127.0.0.1:8000" -ForegroundColor Green
Write-Host "        Docs : http://127.0.0.1:8000/docs" -ForegroundColor Green
Write-Host "        Tekan Ctrl+C untuk berhenti." -ForegroundColor Green
Write-Host ""

& $VENV_PYTHON -m uvicorn main:app --reload
