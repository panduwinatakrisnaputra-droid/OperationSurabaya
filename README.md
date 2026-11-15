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
│       ├── player.py               # PlayerRegister, PlayerLogin, PlayerLogout
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
│       ├── player-app/             # Web Client untuk Player (Lobby, Team, Auth)
│       │   ├── index.html
│       │   ├── style.css
│       │   └── app.js
│       │
│       └── admin-dashboard/        # Web Client untuk Admin (Match Control, Roster, Stats)
│           ├── index.html
│           ├── style.css
│           └── app.js
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
| **Controllers** | `app/Http/Controllers/` | Menangani alur bisnis, operasi database Supabase, validasi aturan main game (HP, damage, match rules). |
| **Models** | `app/Models/` | Merepresentasikan struktur data, entitas, dan validasi payload request/response (Pydantic DTOs). |
| **Views** | `resources/views/` | Lapisan antarmuka pengguna (`player-app` & `admin-dashboard`) berupa HTML, CSS, dan JS interaktif. |
| **Config** | `config/` | Konfigurasi database (`database.py`) dan parameter runtime/CORS (`config.py`). |

---

## Cara Menjalankan

### 1. Menjalankan Backend API
Jalankan langsung dari root repository:
```powershell
# Aktifkan virtual environment
.\.venv\Scripts\Activate.ps1

# Jalankan server FastAPI
uvicorn main:app --reload
```
* **Swagger Interactive Docs:** [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)
* **ReDoc:** [http://127.0.0.1:8000/redoc](http://127.0.0.1:8000/redoc)
* **Health Check:** [http://127.0.0.1:8000/health](http://127.0.0.1:8000/health)

### 2. Menjalankan Views (Frontend)

#### Player Portal:
```powershell
cd resources/views/player-app
python -m http.server 5500
```
Buka di browser: [http://localhost:5500](http://localhost:5500)

#### Admin Dashboard:
```powershell
cd resources/views/admin-dashboard
python -m http.server 5501
```
Buka di browser: [http://localhost:5501](http://localhost:5501)
