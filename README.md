# OPERATION: SURABAYA

Tactical Real-World AI Game System yang menggabungkan web client taktis (Player Portal & Admin Dashboard) dengan FastAPI backend modular, Face Recognition Biometric Auth (OpenCV + dlib/face_recognition), serta QR-code physical tactical gameplay (Weapon Upgrade, Ghost Mode, Base Shutdown, dan Healing Base) yang terhubung ke database Supabase PostgreSQL menggunakan arsitektur **Laravel-style MVC**.

---

## 📁 Struktur Folder (Laravel-Style MVC)

```
OperationSurabaya/
│
├── .gitignore                      # Mengabaikan .env, .venv, log, dan build artifacts
├── .env                            # Kredensial lokal (Supabase URL, API Keys)
├── .env.example                    # Template environment variables
├── requirements.txt                # Dependensi Python
├── main.py                         # Application Bootstrap & Entry Point FastAPI
├── run.ps1                         # Runner script PowerShell untuk Backend
├── run.sh                          # Runner script Bash untuk Backend
├── README.md                       # Dokumentasi resmi project
│
├── app/                            # Core Application Logic (MVC)
│   ├── Http/
│   │   └── Controllers/            # [CONTROLLER] Business Logic, Game Rules, DB Queries
│   │       ├── health_controller.py
│   │       ├── team_controller.py
│   │       ├── player_controller.py    # Face Recognition (128D embedding matching)
│   │       ├── match_controller.py     # Match lifecycle & team assignment
│   │       ├── room_controller.py      # Room browser, custom room creation & join by code
│   │       └── gameplay_controller.py  # Health, Shoot, QR Gameplay (Weapon, Ghost, Base)
│   │
│   └── Models/                     # [MODEL] DTOs & Validation Schema (Pydantic)
│       ├── player.py               # PlayerRegister, PlayerLogin, PlayerFaceLogin
│       ├── match.py                # Room, Team, Shoot, Heal, QR Scans, Timer Models
│       └── __init__.py
│
├── routes/                         # [ROUTES] Endpoints Definition
│   ├── api.py                      # Master Router (aggregates all sub-routers)
│   ├── health_routes.py            # /, /health, /health/db
│   ├── team_routes.py              # /api/teams
│   ├── player_routes.py            # /api/players (Auth, Face Login, Register)
│   ├── room_routes.py              # /api/rooms (Browse, Create, Join Room)
│   ├── match_routes.py             # /api/matches (Lobby, Health, Shoot, QR Objectives, Timer)
│   └── admin_routes.py             # /api/admin (Match Start, Match End, Reset, Weapon Config)
│
├── QR/                             # [PHYSICAL ASSETS] QR Code Targets untuk Arena Fisik
│   ├── base-shutdown-qr/           # Target sabotase Base Shutdown lawan
│   │   ├── BASE-RED.png            # Dipasang di Base RED
│   │   ├── BASE-BLUE.png           # Dipasang di Base BLUE
│   │   └── README.txt              # Aturan main Base Shutdown
│   │
│   ├── ghost-mode-qr/              # Target Ghost Mode (Kekebalan sementara)
│   │   ├── GM-001.png
│   │   └── PRINT_GHOST_MODE_QR.pdf # Lembar cetak siap print
│   │
│   ├── healing-qr/                 # Target Healing Station di Base masing-masing tim
│   │   ├── BASE-RED.png            # Healing Base RED
│   │   ├── BASE-BLUE.png           # Healing Base BLUE
│   │   └── PRINT_HEALING_BASE_QR.pdf # Lembar cetak siap print
│   │
│   └── weapon-upgrade-qr/          # Target Stasiun Upgrade Senjata
│       ├── WS-001.png              # Station 1 (Upgrade Level 2)
│       ├── WS-002.png              # Station 2 (Upgrade Level 3)
│       ├── WS-003.png              # Station 3 (Upgrade Level 4)
│       └── PRINT_WEAPON_UPGRADE_QR.pdf # Lembar cetak siap print
│
├── resources/                      # [VIEW] Client-side Presentation Layer
│   └── views/
│       ├── player-app/             # Web Client untuk Player
│       │   ├── index.html          # UI: Face Auth, Room Browser, Lobby, HUD Gameplay
│       │   ├── style.css           # Styling HUD Neon Cyberpunk & Camera Scanner
│       │   ├── app.js              # State Management, Face Tracking, QR Scanner, Health Poll
│       │   ├── models/             # Bobot neural network face-api.js offline
│       │   └── vendor/             # face-api.min.js & QR libraries
│       │
│       └── admin-dashboard/        # Web Client untuk Admin Arena
│           ├── index.html          # UI: Match Orchestration & Realtime Analytics
│           ├── style.css           # Styling Dashboard Admin
│           └── app.js              # Admin Actions & Event Log Monitor
│
├── storage/                        # Storage Data Lokal
│   └── data/
│       └── faces.json              # Local fallback descriptor biometrik wajah 128D
│
└── config/                         # [CONFIG] Settings & Service Connection
    ├── config.py                   # Environment loader & CORS Configurations
    └── database.py                 # Supabase PostgreSQL Client & Auth Client
```

---

## 🎯 Fitur Utama & Gameplay Mekanik

### 1. Face Recognition Biometric Authentication
- **Dua Opsi Login:** Login konvensional (Email & Password) atau **Biometric Face Recognition**.
- **Real-time Face Tracking:** Menggunakan `face-api.js` di browser untuk mendeteksi wajah langsung dengan bounding box neon dinamis di webcam preview.
- **Backend Recognition:** Snapshot frame dikirim ke FastAPI, diekstrak menjadi **128-dimensional embedding vector** menggunakan OpenCV & `face_recognition` (dlib), lalu dicocokkan menggunakan Euclidean distance threshold $\le 0.54$.

### 2. Room Browser & Dynamic Matchmaking
- Pemain dapat melihat daftar room aktif/waiting di `/api/rooms`.
- **Create Room:** Host dapat menentukan nama room, durasi pertandingan, kapasitas per tim (RED & BLUE), dan nama arena.
- **Join by Code:** Bergabung ke room secara instan menggunakan 8 karakter kode room (misal: `A1B2C3D4`).

### 3. QR-Code Tactical Battlefield System
Pemain dapat berinteraksi dengan pos fisik di arena pertandingan menggunakan kamera smartphone/laptop via built-in QR Scanner:

| Sistem QR | Lokasi Pemasangan | Format Payload | Efek Gameplay |
| :--- | :--- | :--- | :--- |
| **Weapon Upgrade** | Pos tersembunyi di arena | `OPS-WEAPON-UPGRADE:WS-001` | Upgrade level senjata dari Mk-1 (10 DMG) s/d Mk-4 (25 DMG). Tiap station hanya bisa discan 1x per pemain per match. |
| **Ghost Mode** | Pos rahasia di arena | `OPS-GHOST-MODE:GM-001` | Pemain mendapatkan efek kebal (Immunity) dari semua tembakan selama 30 detik. 1x per match. |
| **Healing Base** | Base masing-masing tim | `OPS-HEALING:BASE-RED` / `BASE-BLUE` | Pemulihan HP di base tim sendiri yang diverifikasi dengan QR station + Pose Validation. |
| **Base Shutdown** | Base tim lawan | `OPS-BASE-SHUTDOWN:BASE-RED` / `BASE-BLUE` | Sabotase base lawan! Memicu countdown 10 detik. Jika berhasil bertahan, tim penyerang langsung memenangkan match! |

---

## 🖨️ Panduan Cetak QR Code (Arena Setup)

Seluruh aset QR code sudah disiapkan di folder `QR/`:

1. **Weapon Upgrade Stations:**
   - Buka `QR/weapon-upgrade-qr/PRINT_WEAPON_UPGRADE_QR.pdf` dan cetak pada kertas A4.
   - Pasang stasiun `WS-001`, `WS-002`, dan `WS-003` di lokasi terpisah di arena permainan.
2. **Ghost Mode Treasure:**
   - Buka `QR/ghost-mode-qr/PRINT_GHOST_MODE_QR.pdf` dan cetak.
   - Sembunyikan di area netral yang menantang untuk diperebutkan kedua tim.
3. **Healing Base Stations:**
   - Buka `QR/healing-qr/PRINT_HEALING_BASE_QR.pdf` dan cetak.
   - Pasang `BASE-RED.png` di markas tim Merah, dan `BASE-BLUE.png` di markas tim Biru.
4. **Base Shutdown Sabotage Targets:**
   - Cetak `QR/base-shutdown-qr/BASE-RED.png` (pasang di inti pertahanan base Red).
   - Cetak `QR/base-shutdown-qr/BASE-BLUE.png` (pasang di inti pertahanan base Blue).

---

## 🚀 Panduan Menjalankan Sistem

Pastikan virtual environment `.venv` di direktori project sudah terinstall dependensi dari `requirements.txt`.

### 1. Menjalankan Backend API

Gunakan script siap pakai yang otomatis mendeteksi environment:

**PowerShell:**
```powershell
cd C:\programming\artificial_intelligence_programming\OperationSurabaya
.\run.ps1
```

**Git Bash / Linux:**
```bash
cd /c/programming/artificial_intelligence_programming/OperationSurabaya
bash run.sh
```

**Manual via Uvicorn:**
```powershell
.venv\Scripts\uvicorn.exe main:app --reload --host 127.0.0.1 --port 8000
```

- **API Base:** [http://127.0.0.1:8000](http://127.0.0.1:8000)
- **Interactive Swagger Docs:** [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)
- **Health Check Endpoint:** [http://127.0.0.1:8000/health](http://127.0.0.1:8000/health)

---

### 2. Menjalankan Frontends (Views)

Buka terminal baru untuk menjalankan web server statis:

#### A. Player Portal (Port 5500)
```powershell
cd C:\programming\artificial_intelligence_programming\OperationSurabaya\resources\views\player-app
python -m http.server 5500
```
Akses di browser: [http://localhost:5500](http://localhost:5500)

#### B. Admin Dashboard (Port 5501)
```powershell
cd C:\programming\artificial_intelligence_programming\OperationSurabaya\resources\views\admin-dashboard
python -m http.server 5501
```
Akses di browser: [http://localhost:5501](http://localhost:5501)

---

## ⚙️ Skema Database Supabase

Jika ingin setup ulang database dari scratch, jalankan file SQL migration berikut pada SQL Editor di Supabase:
1. `weapon_upgrade_qr_migration.sql` — Tabel `weapon_upgrade_stations` dan `weapon_upgrade_scans`
2. `ghost_mode_migration.sql` — Tabel `ghost_mode_stations` dan `ghost_mode_scans`
3. `base_shutdown_migration.sql` — Tabel `base_shutdown_stations` dan `base_shutdowns`
4. `healing_system_migration.sql` — Tabel `healing_stations`
