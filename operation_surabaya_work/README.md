# OPERATION: SURABAYA — Two Web Apps

Project contains two separate web frontends and one shared FastAPI backend:
- `player-app/` — player registration, team selection, and waiting lobby.
- `admin-dashboard/` — live match status, team roster, and start/end controls.
- `backend/` — FastAPI connected to Supabase PostgreSQL.

## Important security notes
- `.env` is intentionally excluded. Copy `backend/.env.example` to `backend/.env` and fill in the Supabase Project URL and server-side Secret/Service Role key.
- Never place the Supabase Secret/Service Role key in frontend files or commit it to Git.
- The uploaded archive contained a `.env` file with Supabase credentials. Rotate/revoke that key in Supabase before continuing, then use the new key only in your local backend `.env`.
- Admin endpoints are currently prototype endpoints without admin authentication. Do not expose this backend publicly until authentication and authorization are implemented.
- Player registration creates a profile only. Password authentication and Face Recognition are not implemented yet.
- The Leave Lobby button currently resets the local portal view only; it does not remove the player from `match_players`.

## Requirements
Python 3.11 recommended. Install dependencies inside the backend virtual environment:

```powershell
cd backend
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
copy .env.example .env
```

Fill `backend/.env`, then run:

```powershell
uvicorn main:app --reload
```

API docs: http://127.0.0.1:8000/docs

## Run Player Portal
Open a second terminal:

```powershell
cd player-app
python -m http.server 5501
```
Open http://127.0.0.1:5501

## Run Admin Dashboard
Open a third terminal:

```powershell
cd admin-dashboard
python -m http.server 5502
```
Open http://127.0.0.1:5502

Both frontends call the local API at `http://127.0.0.1:8000`. The backend CORS configuration allows localhost ports 5501 and 5502.

## Connected features
- Player Portal: POST `/api/players/register`, GET `/api/matches/waiting`, POST `/api/matches/{match_id}/join`, GET `/api/matches/{match_id}/lobby`.
- Admin Dashboard: GET `/api/matches/current`, GET `/api/matches/{match_id}/lobby`, POST `/api/admin/matches/{match_id}/start`, POST `/api/admin/matches/{match_id}/end`.
- Admin Dashboard refreshes lobby and match state every four seconds (polling, not WebSocket realtime).

## Current limitations
- Registration is profile creation, not secure login/authentication.
- Face Recognition, camera/WebRTC, YOLO, MediaPipe, player tracking, map, combat analytics, and AI services are not integrated.
- Lobby synchronization uses periodic HTTP polling, not WebSocket/Supabase Realtime.
- Admin endpoints need authentication/authorization and stronger transactional capacity checks before real deployment.

## QR Weapon Upgrade

Fitur upgrade senjata menggunakan QR Code tanpa WUP/poin.

1. Jalankan `backend/weapon_upgrade_qr_migration.sql` sekali di Supabase SQL Editor.
2. Jalankan ulang backend FastAPI.
3. Cetak tiga QR Code dengan isi teks persis berikut:
   - `OPS-WEAPON-UPGRADE:WS-001`
   - `OPS-WEAPON-UPGRADE:WS-002`
   - `OPS-WEAPON-UPGRADE:WS-003`
4. Tempel QR di tiga Weapon Upgrade Station yang berbeda.
5. Saat pertandingan aktif, pemain menekan **SCAN QR UPGRADE** pada Player Portal dan mengarahkan kamera gameplay ke QR.

Setiap station hanya dapat digunakan satu kali oleh pemain dalam satu pertandingan. Tiga station memungkinkan upgrade bertahap Level 1 → 2 → 3 → 4. Level maksimum tetap 4. QR hanya berlaku saat match aktif dan pemain belum tereliminasi. Riwayat upgrade masuk ke `game_events` dengan event type `weapon_upgrade`.

QR dapat dibuat menggunakan aplikasi pembuat QR Code apa pun. Pastikan tipe kontennya Text dan jangan menambahkan spasi atau URL di depan/belakang payload.

Catatan browser: pemindaian memakai `BarcodeDetector` bawaan browser. Gunakan Chrome/Edge versi terbaru dan izinkan akses kamera; browser harus berjalan pada localhost atau HTTPS.

File QR siap cetak tersedia di folder `weapon-upgrade-qr/` (PNG per station dan `PRINT_WEAPON_UPGRADE_QR.pdf`). Cetak satu QR untuk setiap station.

## Ghost Mode Treasure (baru)

1. Jalankan `backend/ghost_mode_migration.sql` sekali di Supabase SQL Editor.
2. QR Treasure Ghost Mode harus berisi teks persis `OPS-GHOST-MODE:GM-001`.
3. Durasi awal efek adalah 30 detik; ubah `duration_seconds` pada tabel `ghost_mode_stations` jika diperlukan.
4. Pemain membuka gameplay lalu menekan `CLAIM GHOST` dan scan QR (kamera atau unggah gambar).
5. Efek berlaku untuk pemain yang memindai QR, bukan seluruh tim. Pemain tetap dapat menembak, tetapi endpoint damage akan menolak damage selama `ghost_mode_until` masih aktif.
6. QR treasure yang sama hanya dapat diklaim satu kali oleh pemain pada satu pertandingan.

Catatan: endpoint damage saat ini adalah `/api/matches/{match_id}/health/update`. Jika nanti AI Combat menerapkan damage melalui endpoint baru atau langsung ke database, validasi `ghost_mode_until` juga harus diterapkan di jalur tersebut.


## Base Healing (QR + Pose Detection)
1. Jalankan `backend/healing_system_migration.sql` satu kali di Supabase SQL Editor.
2. QR base RED berisi `OPS-HEALING:BASE-RED`; QR base BLUE berisi `OPS-HEALING:BASE-BLUE`.
3. Pemain membuka `BASE HEALING`, scan QR base tim sendiri, lalu menu healing terbuka.
4. Pose detector yang sudah ditentukan perlu mengirim event browser `ops-healing-pose-valid` dengan `{ valid: true }` selama pose benar dan `{ valid: false }` saat pose terlepas.
5. Pose harus terdeteksi terus-menerus selama 5 detik. Backend kemudian memulihkan 20 HP (maksimal sesuai max_health).

### Integrasi modul pose yang sudah ada
Setelah modul pose detector dimuat, set `window.OPERATION_SURABAYA_POSE_DETECTOR_READY = true`. Saat pose healing yang telah didefinisikan terdeteksi, panggil:
`window.dispatchEvent(new CustomEvent('ops-healing-pose-valid', { detail: { valid: true } }));`
Saat pose tidak lagi terdeteksi, kirim `valid: false`. Event ini adalah jembatan integrasi; file project ini belum berisi model atau definisi pose spesifik, sehingga modul pose milik project harus dihubungkan ke event tersebut.

## Base Shutdown (tambahan)
1. Jalankan `backend/base_shutdown_migration.sql` sekali di Supabase SQL Editor.
2. Restart FastAPI.
3. QR untuk base RED dan BLUE tersedia di folder `base-shutdown-qr/`.
4. Pasang `BASE-RED.png` di base RED dan `BASE-BLUE.png` di base BLUE.
5. Payload masing-masing: `OPS-BASE-SHUTDOWN:BASE-RED` dan `OPS-BASE-SHUTDOWN:BASE-BLUE`.
6. Pemain scan QR base lawan. Player Portal menjalankan countdown 10 detik; jika selesai, backend memvalidasi tim dan mengakhiri match dengan `winner_team_code`.

Catatan: countdown saat ini berjalan di sisi Player Portal; endpoint backend tetap memvalidasi status match, keanggotaan, tim penyerang/lawan, status eliminasi, dan mencegah penyelesaian base lebih dari sekali per match. Untuk deployment produksi, countdown perlu dipindahkan sepenuhnya ke backend dan ditambah validasi gangguan/interupsi berbasis event.
