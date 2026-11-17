#!/usr/bin/env bash
# ==========================================
# OPERATION: SURABAYA - Backend Runner
# Gunakan Git Bash untuk menjalankan script ini
# ==========================================

# Pindah ke direktori project (root OperationSurabaya)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

VENV_PYTHON="$SCRIPT_DIR/.venv/Scripts/python.exe"

echo "======================================"
echo "  OPERATION: SURABAYA — Backend API"
echo "======================================"
echo ""

# Verifikasi venv
if [ ! -f "$VENV_PYTHON" ]; then
    echo "[ERROR] .venv tidak ditemukan di:"
    echo "  $VENV_PYTHON"
    echo ""
    echo "Pastikan .venv sudah dibuat di root project:"
    echo "  python -m venv .venv"
    echo "  .venv/Scripts/pip install -r requirements.txt"
    exit 1
fi

# Cek dependensi kritis
echo "[CHECK] Memeriksa dependensi face_recognition & OpenCV..."
"$VENV_PYTHON" -c "import cv2, face_recognition, fastapi; print('[OK] Semua dependensi tersedia.')" 2>/dev/null
if [ $? -ne 0 ]; then
    echo "[WARN] Beberapa dependensi mungkin belum terinstal."
    echo "       Jalankan: $VENV_PYTHON -m pip install face-recognition opencv-contrib-python fastapi uvicorn"
fi

echo ""
echo "[START] Menjalankan FastAPI server di http://127.0.0.1:8000"
echo "        Docs: http://127.0.0.1:8000/docs"
echo "        Tekan Ctrl+C untuk berhenti."
echo ""

"$VENV_PYTHON" -m uvicorn main:app --reload

