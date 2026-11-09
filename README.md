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
