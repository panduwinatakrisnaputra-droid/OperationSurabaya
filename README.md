# OPERATION: SURABAYA

Tactical AI game system built with decoupled frontends and a modular FastAPI backend connected to Supabase PostgreSQL, following a standard **Laravel-style MVC Architecture**.

---

## Struktur Folder (Laravel-Style MVC)

```
OperationSurabaya/
│
├── .gitignore                      # Mengabaikan .env, .venv, log, dan build artifacts
├── .env                            # Kredensial lokal (Supabase URL, API Keys)
├── .env.example                    # Template environment variables
├── requirements.txt                # Dependensi Python
├── main.py                         # Application Bootstrap & Entry Point
├── README.md                       # Dokumentasi project
│
├── app/                            # Core Application Logic
│   ├── Http/
│   │   └── Controllers/            # [CONTROLLER] Business Logic, Validasi Game, DB Queries
│   │       ├── health_controller.py
│   │       ├── team_controller.py
│   │       ├── player_controller.py
│   │       ├── match_controller.py
│   │       └── gameplay_controller.py
│   │
│   └── Models/                     # [MODEL] Data Representation & DTOs (Pydantic Models)
│       ├── player.py               # PlayerRegister, PlayerLogin, PlayerLogout, PlayerFaceLogin
│       ├── match.py                # TeamSelection, LeaveTeam, HealthUpdate, Shoot, Heal
│       └── __init__.py
│
├── routes/                         # [ROUTES] Route Definitions & Endpoints
│   ├── api.py                      # Master Router (menggabungkan semua route module)
│   ├── health_routes.py            # /, /health, /health/db
│   ├── team_routes.py              # /api/teams
│   ├── player_routes.py            # /api/players/*
│   ├── match_routes.py             # /api/matches/*
│   └── admin_routes.py             # /api/admin/*
│
├── resources/                      # [VIEW] Client-side Presentation Layer
│   └── views/
│       ├── player-app/             # Web Client untuk Player (Face Scan Auth, Lobby, Team)
│       │   ├── index.html
│       │   ├── style.css
│       │   ├── app.js
│       │   ├── models/             # Bobot neural network face-api.js offline
│       │   └── vendor/             # face-api.min.js
│       │
│       └── admin-dashboard/        # Web Client untuk Admin (Match Control, Roster, Stats)
│           ├── index.html
│           ├── style.css
│           └── app.js
│
├── storage/                        # Penyimpanan data lokal
│   └── data/
│       └── faces.json              # Database profil biometrik wajah 128D
│
└── config/                         # [CONFIG] Pengaturan & Service Connection
    ├── config.py                   # App Configuration, CORS Origins, ENV Load
    └── database.py                 # Supabase PostgreSQL Client & Supabase Auth Client
```

---

## Pemetaan Komponen (Laravel Concept)

| Komponen Laravel | Lokasi di Project | Tanggung Jawab / Deskripsi |
| :--- | :--- | :--- |
| **Routes** | `routes/` (`api.py`, `*_routes.py`) | Menentukan URL path, HTTP method (`GET`, `POST`, `DELETE`), dan mengarahkan ke Controller terkait. |
| **Controllers** | `app/Http/Controllers/` | Menangani alur bisnis, Face Recognition matching, query Supabase, validasi aturan main (HP, damage, match). |
| **Models** | `app/Models/` | Merepresentasikan struktur data, entitas, dan validasi payload request/response (Pydantic DTOs). |
| **Views** | `resources/views/` | Lapisan antarmuka pengguna (`player-app` & `admin-dashboard`) dengan live webcam scan. |
| **Config** | `config/` | Konfigurasi database (`database.py`) dan parameter runtime/CORS (`config.py`). |

---

## Cara Menjalankan

> [!IMPORTANT]
> Backend **wajib** dijalankan menggunakan **CHAPTER-6 venv** (bukan `.venv` proyek ini), karena `face_recognition` dan `opencv-contrib-python` sudah terinstal di sana.
> Path venv: `C:\programming\artificial_intelligence_programming\CHAPTER-6\venv\`

---

### 1. Menjalankan Backend API

#### Cara Cepat — Script Siap Pakai

**Git Bash:**
```bash
cd /c/programming/artificial_intelligence_programming/OperationSurabaya
bash run.sh
```

**PowerShell:**
```powershell
cd C:\programming\artificial_intelligence_programming\OperationSurabaya
.\run.ps1
```

---

#### Manual — Git Bash
```bash
# 1. Masuk ke root project
cd /c/programming/artificial_intelligence_programming/OperationSurabaya

# 2. Aktifkan CHAPTER-6 venv (bukan .venv proyek ini!)
source /c/programming/artificial_intelligence_programming/CHAPTER-6/venv/Scripts/activate

# 3. Jalankan server FastAPI
uvicorn main:app --reload
```

#### Manual — PowerShell
```powershell
# 1. Masuk ke root project
cd C:\programming\artificial_intelligence_programming\OperationSurabaya

# 2. Aktifkan CHAPTER-6 venv
& "C:\programming\artificial_intelligence_programming\CHAPTER-6\venv\Scripts\Activate.ps1"

# 3. Jalankan server FastAPI
uvicorn main:app --reload
```

> [!TIP]
> Atau gunakan langsung tanpa activate:
> ```bash
> /c/programming/artificial_intelligence_programming/CHAPTER-6/venv/Scripts/uvicorn main:app --reload
> ```

* **Swagger Interactive Docs:** [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)
* **ReDoc:** [http://127.0.0.1:8000/redoc](http://127.0.0.1:8000/redoc)
* **Health Check:** [http://127.0.0.1:8000/health](http://127.0.0.1:8000/health)

---

### 2. Menjalankan Views (Frontend)

Buka **terminal baru** (pisah dari terminal backend) untuk masing-masing frontend:

#### A. Player Portal (Port 5500)

**Git Bash:**
```bash
cd /c/programming/artificial_intelligence_programming/OperationSurabaya/resources/views/player-app
python -m http.server 5500
```

**PowerShell:**
```powershell
cd C:\programming\artificial_intelligence_programming\OperationSurabaya\resources\views\player-app
python -m http.server 5500
```
Buka di browser: [http://localhost:5500](http://localhost:5500)

> [!IMPORTANT]
> Saat membuka player portal, **izinkan akses kamera/webcam** di browser (klik *Allow* saat dialog muncul).
> Face Recognition hanya bekerja via `localhost` atau `https://` — **jangan** buka file HTML langsung (`file://`).

---

#### B. Admin Dashboard (Port 5501)

**Git Bash:**
```bash
cd /c/programming/artificial_intelligence_programming/OperationSurabaya/resources/views/admin-dashboard
python -m http.server 5501
```

**PowerShell:**
```powershell
cd C:\programming\artificial_intelligence_programming\OperationSurabaya\resources\views\admin-dashboard
python -m http.server 5501
```
Buka di browser: [http://localhost:5501](http://localhost:5501)



---

## 3. Face Recognition System (OpenCV & face_recognition)

Diadaptasi dari **Example 6.13** (OpenCV Haar Cascade) dan **Example 6.14** (`face_recognition` / 128D Deep Metric).

### Arsitektur Autentikasi

```
Browser (Webcam)
    │
    │  JPEG frame (Base64)
    ▼
FastAPI Backend ──► face_recognition.face_encodings() ──► 128D descriptor
    │
    │  Euclidean Distance matching (threshold 0.54)
    ▼
faces.json ──► match found → return session token
```

### Alur Registrasi
1. User buka `http://localhost:5500` → browser minta izin kamera → klik **Allow**
2. User klik tab **REGISTER** → isi username & nama lengkap
3. User klik **DAFTARKAN WAJAH** → snapshot JPEG dikirim ke `POST /api/players/register`
4. Backend ekstrak 128D descriptor → simpan ke `storage/data/faces.json`

### Alur Login
1. User buka `http://localhost:5500` → kamera otomatis aktif
2. User klik **SCAN WAJAH & MASUK** → snapshot dikirim ke `POST /api/players/face-login`
3. Backend bandingkan descriptor dengan semua entri di `faces.json`
4. Jika distance < 0.54 → login berhasil → masuk ke lobby

---

### Cara Menjalankan Native OpenCV Face Authenticator (Standalone Desktop):

**Git Bash:**
```bash
/c/programming/artificial_intelligence_programming/CHAPTER-6/venv/Scripts/python.exe face_auth_opencv.py
```

**PowerShell:**
```powershell
& "C:\programming\artificial_intelligence_programming\CHAPTER-6\venv\Scripts\python.exe" face_auth_opencv.py
```

* **Jendela Kamera OpenCV** akan langsung terbuka di layar laptop.
* **Deteksi Wajah Real-Time:** Menampilkan bounding box hijau di wajah.
* **Tekan tombol keyboard:**
  * **[R]**: Mendaftarkan wajah baru (masukkan Username & Nama di terminal).
  * **[L]**: Login instan hanya dengan memindai wajah (otomatis mencocokkan ke database server 127.0.0.1:8000).
  * **[Q]**: Keluar dari aplikasi kamera.

---

## 4. Troubleshooting

| Masalah | Solusi |
|---------|--------|
| `ModuleNotFoundError: face_recognition` | Pastikan menggunakan **CHAPTER-6 venv**, bukan `.venv` proyek ini |
| Kamera tidak muncul di browser | Buka via `http://localhost:5500`, **bukan** `file://` |
| `Tidak ada wajah terdeteksi` (400) | Pastikan wajah menghadap lurus ke kamera, pencahayaan cukup |
| `Wajah tidak dikenali` (401) | Daftar ulang dengan pencahayaan yang sama; ubah threshold di `player_controller.py` → `THRESHOLD` |
| Backend tidak jalan / import error | Jalankan `run.sh` atau `run.ps1` yang sudah menggunakan CHAPTER-6 venv |
| CORS error di browser | Pastikan backend jalan di port 8000 dan frontend di port 5500 |
