
import os
import asyncio

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from supabase import create_client, Client
from pydantic import BaseModel, Field
from datetime import datetime, timezone

# Load environment variables
load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("Supabase credentials belum dikonfigurasi!")

# Connect Supabase Database
supabase: Client = create_client(
    SUPABASE_URL,
    SUPABASE_KEY
)

# Connect Supabase Authentication
supabase_auth: Client = create_client(
    SUPABASE_URL,
    SUPABASE_ANON_KEY
)

# Initialize FastAPI
app = FastAPI(
    title="OPERATION: SURABAYA API",
    description="Backend API for AI Tactical Game",
    version="1.0.0"
)

# CORS - development configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5500",
        "http://127.0.0.1:5500",
        "http://localhost:5501",
        "http://127.0.0.1:5501",
        "http://localhost:5502",
        "http://127.0.0.1:5502",
        "http://localhost:3000",
        "http://127.0.0.1:3000"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)


@app.get("/")
def home():
    return {
        "project": "OPERATION: SURABAYA",
        "message": "Backend is running!",
        "status": "online"
    }


@app.get("/health")
def health():
    return {
        "status": "healthy",
        "backend": "FastAPI"
    }


@app.get("/health/db")
def health_db():
    try:
        result = supabase.table("players").select("id").limit(1).execute()

        return {
            "status": "connected",
            "database": "Supabase PostgreSQL",
            "project_url": SUPABASE_URL,
            "players_found": len(result.data)
        }

    except Exception as e:
        return {
            "status": "error",
            "message": str(e)
        }

@app.get("/api/teams")
def get_teams():
    try:
        response = (
            supabase
            .table("teams")
            .select("*")
            .execute()
        )

        return {
            "success": True,
            "data": response.data
        }

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=str(error)
        )
# ==============================
# PLAYER MANAGEMENT
# ==============================


class PlayerRegister(BaseModel):
    username: str = Field(min_length=3, max_length=30)
    full_name: str = Field(min_length=2, max_length=100)
    email: str
    password: str = Field(min_length=8)


@app.post("/api/players/register")
def register_player(player: PlayerRegister):
    auth_user_id = None

    try:
        email = player.email.strip().lower()
        username = player.username.strip()

        # 1. Periksa apakah username sudah digunakan
        username_check = (
            supabase.table("players")
            .select("id, email")
            .eq("username", username)
            .limit(1)
            .execute()
        )

        # 2. Cari profil lama berdasarkan email
        email_check = (
            supabase.table("players")
            .select("id, email, auth_user_id")
            .eq("email", email)
            .limit(1)
            .execute()
        )

        existing_player = (
            email_check.data[0] if email_check.data else None
        )

        # Username tidak boleh dipakai pemain lain
        if username_check.data:
            username_owner = username_check.data[0]

            if (
                not existing_player
                or username_owner["id"] != existing_player["id"]
            ):
                raise HTTPException(
                    status_code=409,
                    detail="Username sudah digunakan"
                )

        # Profil sudah terhubung dengan akun Auth
        if existing_player and existing_player.get("auth_user_id"):
            raise HTTPException(
                status_code=409,
                detail="Email sudah terdaftar. Silakan login."
            )

        # 3. Buat akun di Supabase Authentication
        auth_response = supabase.auth.admin.create_user({
            "email": email,
            "password": player.password,
            "email_confirm": True
        })

        auth_user = auth_response.user

        if not auth_user:
            raise Exception("Gagal membuat akun Supabase Auth")

        auth_user_id = auth_user.id

        # 4. Hubungkan akun Auth dengan profil pemain
        if existing_player:
            profile_response = (
                supabase.table("players")
                .update({
                    "auth_user_id": auth_user_id,
                    "username": username,
                    "full_name": player.full_name,
                    "email": email,
                    "status": "offline"
                })
                .eq("id", existing_player["id"])
                .execute()
            )
        else:
            profile_response = (
                supabase.table("players")
                .insert({
                    "auth_user_id": auth_user_id,
                    "username": username,
                    "full_name": player.full_name,
                    "email": email,
                    "status": "offline"
                })
                .execute()
            )

        if not profile_response.data:
            raise Exception("Gagal menyimpan profil pemain")

        return {
            "success": True,
            "message": "Registrasi berhasil. Silakan login.",
            "player": profile_response.data[0]
        }

    except HTTPException:
        raise

    except Exception as error:
        # Hapus akun Auth jika pembuatan profil gagal
        if auth_user_id:
            try:
                supabase.auth.admin.delete_user(auth_user_id)
            except Exception as cleanup_error:
                print("AUTH CLEANUP ERROR:", repr(cleanup_error))

        print("REGISTER ERROR:", repr(error))

        raise HTTPException(
            status_code=500,
            detail="Registrasi gagal. Periksa backend."
        )



class PlayerLogin(BaseModel):
    email: str
    password: str = Field(min_length=8)


@app.post("/api/players/login")
def login_player(player: PlayerLogin):
    try:
        email = player.email.strip().lower()

        # 1. Verifikasi email dan password
        auth_response = supabase_auth.auth.sign_in_with_password({
            "email": email,
            "password": player.password
        })

        user = auth_response.user
        session = auth_response.session

        if not user or not session:
            raise HTTPException(
                status_code=401,
                detail="Email atau password salah"
            )

        # 2. Cari profil berdasarkan UUID Auth
        profile = (
            supabase.table("players")
            .select("id, username, full_name, email, status, auth_user_id")
            .eq("auth_user_id", user.id)
            .limit(1)
            .execute()
        )

        # 3. Jika tidak ditemukan, cari berdasarkan email
        if not profile.data:
            profile = (
                supabase.table("players")
                .select("id, username, full_name, email, status, auth_user_id")
                .ilike("email", email)
                .limit(1)
                .execute()
            )

            # Profil benar-benar tidak ditemukan
            if not profile.data:
                print("LOGIN DEBUG - AUTH USER ID:", user.id)
                print("LOGIN DEBUG - EMAIL:", email)
                print("LOGIN DEBUG - PROFILE:", profile.data)

                raise HTTPException(
                    status_code=404,
                    detail=(
                        "Akun Auth ditemukan, tetapi profil pemain "
                        "tidak ditemukan di database backend."
                    )
                )

            player_data = profile.data[0]

            # Jangan menghubungkan profil milik akun lain
            if (
                player_data.get("auth_user_id")
                and player_data["auth_user_id"] != user.id
            ):
                raise HTTPException(
                    status_code=409,
                    detail="Profil ini sudah terhubung dengan akun lain."
                )

            # 4. Hubungkan profil lama dengan UUID Auth
            if not player_data.get("auth_user_id"):
                linked = (
                    supabase.table("players")
                    .update({"auth_user_id": user.id})
                    .eq("id", player_data["id"])
                    .execute()
                )

                if not linked.data:
                    raise Exception(
                        "Gagal menghubungkan profil dengan akun Auth"
                    )

                player_data = linked.data[0]

        else:
            player_data = profile.data[0]

        # 5. Update status pemain
        updated = (
            supabase.table("players")
            .update({"status": "online"})
            .eq("id", player_data["id"])
            .execute()
        )

        if updated.data:
            player_data["status"] = "online"

        print("LOGIN BERHASIL:", user.id, player_data["username"])

        return {
            "success": True,
            "message": "Login berhasil",
            "access_token": session.access_token,
            "refresh_token": session.refresh_token,
            "player": player_data
        }

    except HTTPException:
        raise

    except Exception as error:
        print("LOGIN ERROR:", repr(error))

        raise HTTPException(
            status_code=401,
            detail="Login gagal. Periksa konfigurasi backend."
        )

class PlayerLogout(BaseModel):
    access_token: str

@app.post("/api/players/logout")
def logout_player(data: PlayerLogout):
    try:
        # Buat client Supabase khusus sesi pengguna
        user_client = create_client(
            SUPABASE_URL,
            os.getenv("SUPABASE_ANON_KEY")
        )

        # Pasang access token pengguna
        user_client.auth.set_session(
            data.access_token,
            ""
        )

        # Ambil identitas pengguna
        user = user_client.auth.get_user(data.access_token).user

        if not user:
            raise HTTPException(
                status_code=401,
                detail="Sesi tidak valid"
            )

        # Ubah status pemain menjadi offline
        supabase.table("players").update({
            "status": "offline"
        }).eq("auth_user_id", user.id).execute()

        # Logout dari Supabase Auth
        user_client.auth.sign_out()

        return {
            "success": True,
            "message": "Logout berhasil"
        }

    except HTTPException:
        raise

    except Exception:
        raise HTTPException(
            status_code=401,
            detail="Gagal melakukan logout"
        )
    
@app.get("/api/players")
def get_players():
    try:
        response = (
            supabase.table("players")
            .select("*")
            .execute()
        )

        return {
            "success": True,
            "total": len(response.data),
            "data": response.data
        }

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=str(error)
        )
        # ==========================================
# TEAM SELECTION & WAITING LOBBY API
# ==========================================

class TeamSelection(BaseModel):
    player_id: str
    team_code: str = Field(pattern="^(RED|BLUE)$")


@app.get("/api/matches/waiting")
def get_waiting_match():
    """Mengambil pertandingan yang sedang menunggu pemain."""
    try:
        response = (
            supabase.table("matches")
            .select("*")
            .eq("status", "waiting")
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )

        if not response.data:
            return {
                "success": True,
                "message": "Belum ada pertandingan waiting",
                "data": None
            }

        return {
            "success": True,
            "data": response.data[0]
        }

    except Exception as error:
        raise HTTPException(status_code=500, detail=str(error))


@app.post("/api/matches/{match_id}/join")
def select_team(match_id: str, selection: TeamSelection):
    """Memasukkan pemain ke pertandingan sekaligus memilih tim."""
    try:
        # 1. Periksa pertandingan
        match_response = (
            supabase.table("matches")
            .select("*")
            .eq("id", match_id)
            .limit(1)
            .execute()
        )

        if not match_response.data:
            raise HTTPException(status_code=404, detail="Pertandingan tidak ditemukan")

        match = match_response.data[0]

        if match["status"] != "waiting":
            raise HTTPException(status_code=400, detail="Pertandingan sudah tidak menerima pemain")

        # 2. Periksa pemain
        player_response = (
            supabase.table("players")
            .select("id, username, full_name, status")
            .eq("id", selection.player_id)
            .limit(1)
            .execute()
        )

        if not player_response.data:
            raise HTTPException(status_code=404, detail="Pemain tidak ditemukan")

        # 3. Cari tim berdasarkan kode
        team_response = (
            supabase.table("teams")
            .select("id, team_code, team_name")
            .eq("team_code", selection.team_code)
            .limit(1)
            .execute()
        )

        if not team_response.data:
            raise HTTPException(status_code=404, detail="Tim tidak ditemukan")

        team = team_response.data[0]

        # 4. Periksa apakah pemain sudah masuk pertandingan ini
        existing = (
            supabase.table("match_players")
            .select("id")
            .eq("match_id", match_id)
            .eq("player_id", selection.player_id)
            .limit(1)
            .execute()
        )

        # 5. Periksa kapasitas jika pemain baru bergabung
        if not existing.data:
            members = (
                supabase.table("match_players")
                .select("id")
                .eq("match_id", match_id)
                .execute()
            )

            if len(members.data) >= match["max_players"]:
                raise HTTPException(status_code=400, detail="Lobby sudah penuh")

            # 6. Masukkan pemain ke pertandingan
            result = (
                supabase.table("match_players")
                .insert({
                    "match_id": match_id,
                    "player_id": selection.player_id,
                    "team_id": team["id"],
                    "player_status": "joined",
                    "current_health": 100,
                    "max_health": 100,
                    "is_eliminated": False,
                    "is_healing": False
                })
                .execute()
            )

        else:
            # Pemain sudah bergabung: perbarui pilihan tim
            result = (
                supabase.table("match_players")
                .update({"team_id": team["id"]})
                .eq("match_id", match_id)
                .eq("player_id", selection.player_id)
                .execute()
            )

        return {
            "success": True,
            "message": f"Berhasil bergabung ke {team['team_name']}",
            "match_id": match_id,
            "player": player_response.data[0],
            "team": team,
            "data": result.data
        }

    except HTTPException:
        raise

    except Exception as error:
        raise HTTPException(status_code=500, detail=str(error))

# ==========================================
# LEAVE TEAM API
# ==========================================

class LeaveTeamRequest(BaseModel):
    player_id: str


@app.post("/api/matches/{match_id}/leave")
def leave_team(match_id: str, data: LeaveTeamRequest):
    try:
        # 1. Periksa pertandingan
        match_response = (
            supabase.table("matches")
            .select("id, status")
            .eq("id", match_id)
            .limit(1)
            .execute()
        )

        if not match_response.data:
            raise HTTPException(
                status_code=404,
                detail="Pertandingan tidak ditemukan"
            )

        match = match_response.data[0]

        # 2. Pemain hanya boleh keluar saat pertandingan waiting
        if match["status"] != "waiting":
            raise HTTPException(
                status_code=400,
                detail="Tidak dapat keluar setelah pertandingan dimulai"
            )

        # 3. Hapus keanggotaan pemain dari pertandingan
        result = (
            supabase.table("match_players")
            .delete()
            .eq("match_id", match_id)
            .eq("player_id", data.player_id)
            .execute()
        )

        if not result.data:
            raise HTTPException(
                status_code=404,
                detail="Pemain tidak ditemukan dalam tim"
            )

        return {
            "success": True,
            "message": "Berhasil keluar dari tim"
        }

    except HTTPException:
        raise

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=str(error)
        )
    
@app.get("/api/matches/{match_id}/lobby")
def get_waiting_lobby(match_id: str):
    """Mengambil daftar pemain berdasarkan tim dalam lobby."""
    try:
        # 1. Ambil pertandingan
        match_response = (
            supabase.table("matches")
            .select("*")
            .eq("id", match_id)
            .limit(1)
            .execute()
        )

        if not match_response.data:
            raise HTTPException(status_code=404, detail="Pertandingan tidak ditemukan")

        match = match_response.data[0]

        # 2. Ambil seluruh anggota pertandingan
        members_response = (
            supabase.table("match_players")
            .select("*")
            .eq("match_id", match_id)
            .execute()
        )

        members = members_response.data or []

        # 3. Ambil data pemain dan tim
        player_ids = list(set(item["player_id"] for item in members))
        team_ids = list(set(item["team_id"] for item in members))

        players = []
        teams = []

        if player_ids:
            players = (
                supabase.table("players")
                .select("id, username, full_name, status")
                .in_("id", player_ids)
                .execute()
            ).data or []

        if team_ids:
            teams = (
                supabase.table("teams")
                .select("id, team_code, team_name, team_color")
                .in_("id", team_ids)
                .execute()
            ).data or []

        player_map = {p["id"]: p for p in players}
        team_map = {t["id"]: t for t in teams}

        red_players = []
        blue_players = []

        for member in members:
            player = player_map.get(member["player_id"])
            team = team_map.get(member["team_id"])

            if not player or not team:
                continue

            entry = {
                "player": player,
                "player_status": member.get("player_status"),
                "joined_at": member.get("joined_at")
            }

            if team["team_code"] == "RED":
                red_players.append(entry)
            elif team["team_code"] == "BLUE":
                blue_players.append(entry)

        return {
            "success": True,
            "match": match,
            "lobby": {
                "total_players": len(members),
                "max_players": match["max_players"],
                "red_team": {
                    "team_name": "Red Team",
                    "total": len(red_players),
                    "players": red_players
                },
                "blue_team": {
                    "team_name": "Blue Team",
                    "total": len(blue_players),
                    "players": blue_players
                }
            }
        }

    except HTTPException:
        raise

    except Exception as error:
        raise HTTPException(status_code=500, detail=str(error))

    # ==========================================
# ADMIN MATCH CONTROL API
# ==========================================

@app.post("/api/admin/matches/{match_id}/start")
def admin_start_match(match_id: str):
    try:
        # 1. Periksa pertandingan
        match_response = (
            supabase.table("matches")
            .select("*")
            .eq("id", match_id)
            .limit(1)
            .execute()
        )

        if not match_response.data:
            raise HTTPException(
                status_code=404,
                detail="Pertandingan tidak ditemukan"
            )

        match = match_response.data[0]

        # 2. Pastikan pertandingan masih waiting
        if match["status"] != "waiting":
            raise HTTPException(
                status_code=400,
                detail=f"Tidak dapat memulai pertandingan dengan status {match['status']}"
            )

        # 3. Pastikan ada pemain yang bergabung
        members_response = (
            supabase.table("match_players")
            .select("id")
            .eq("match_id", match_id)
            .execute()
        )

        total_players = len(members_response.data or [])

        if total_players < 1:
            raise HTTPException(
                status_code=400,
                detail="Belum ada pemain yang bergabung"
            )

        # 4. Ubah status menjadi active
        response = (
            supabase.table("matches")
            .update({
                "status": "active",
                "started_at": datetime.now(timezone.utc).isoformat()
            })
            .eq("id", match_id)
            .eq("status", "waiting")
            .execute()
        )

        if not response.data:
            raise HTTPException(
                status_code=409,
                detail="Status pertandingan berubah. Silakan muat ulang."
            )

        return {
            "success": True,
            "message": "Pertandingan berhasil dimulai",
            "total_players": total_players,
            "data": response.data[0]
        }

    except HTTPException:
        raise

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=str(error)
        )


@app.post("/api/admin/matches/{match_id}/end")
def admin_end_match(match_id: str):
    try:
        # 1. Periksa pertandingan
        match_response = (
            supabase.table("matches")
            .select("*")
            .eq("id", match_id)
            .limit(1)
            .execute()
        )

        if not match_response.data:
            raise HTTPException(
                status_code=404,
                detail="Pertandingan tidak ditemukan"
            )

        match = match_response.data[0]

        # 2. Pastikan pertandingan sedang active
        if match["status"] != "active":
            raise HTTPException(
                status_code=400,
                detail=f"Pertandingan belum aktif atau sudah selesai. Status: {match['status']}"
            )

        # 3. Ubah status menjadi completed
        response = (
            supabase.table("matches")
            .update({
                "status": "completed",
                "ended_at": datetime.now(timezone.utc).isoformat()
            })
            .eq("id", match_id)
            .eq("status", "active")
            .execute()
        )

        if not response.data:
            raise HTTPException(
                status_code=409,
                detail="Status pertandingan berubah. Silakan muat ulang."
            )

        return {
            "success": True,
            "message": "Pertandingan berhasil diakhiri",
            "data": response.data[0]
        }

    except HTTPException:
        raise

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=str(error)
        )

@app.get("/api/matches/current")
def get_current_match():
    """Mengambil pertandingan terbaru, termasuk yang sudah completed."""
    try:
        response = (
            supabase.table("matches")
            .select("*")
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        return {"success": True, "data": response.data[0] if response.data else None}
    except Exception as error:
        raise HTTPException(status_code=500, detail=str(error))


@app.delete("/api/admin/matches/all")
def delete_all_matches():
    """Menghapus seluruh data pertandingan, tetapi mempertahankan akun pemain dan data tim."""
    try:
        # Hapus tabel anak terlebih dahulu agar tidak terhalang foreign key.
        events_response = (
            supabase.table("game_events")
            .delete()
            .neq("id", "00000000-0000-0000-0000-000000000000")
            .execute()
        )

        players_response = (
            supabase.table("match_players")
            .delete()
            .neq("id", "00000000-0000-0000-0000-000000000000")
            .execute()
        )

        matches_response = (
            supabase.table("matches")
            .delete()
            .neq("id", "00000000-0000-0000-0000-000000000000")
            .execute()
        )

        return {
            "success": True,
            "message": "Seluruh data pertandingan berhasil dihapus.",
            "deleted_events": len(events_response.data or []),
            "deleted_match_players": len(players_response.data or []),
            "deleted_matches": len(matches_response.data or [])
        }

    except Exception as error:
        print("DELETE ALL MATCHES ERROR:", repr(error))
        raise HTTPException(
            status_code=500,
            detail="Gagal menghapus seluruh data pertandingan: " + str(error)
        )

    # ==========================================
# PLAYER HEALTH MONITORING API
# ==========================================

@app.get("/api/matches/{match_id}/health")
def get_match_health(match_id: str):
    try:
        # 1. Ambil anggota pertandingan
        members_response = (
            supabase.table("match_players")
            .select("*")
            .eq("match_id", match_id)
            .execute()
        )

        members = members_response.data or []

        if not members:
            return {
                "success": True,
                "total_players": 0,
                "players": []
            }

        # 2. Ambil data pemain
        player_ids = list(set(
            item["player_id"] for item in members
        ))

        players_response = (
            supabase.table("players")
            .select("id, username, full_name")
            .in_("id", player_ids)
            .execute()
        )

        player_map = {
            p["id"]: p for p in (players_response.data or [])
        }

        # 3. Ambil data tim
        team_ids = list(set(
            item["team_id"] for item in members
        ))

        teams_response = (
            supabase.table("teams")
            .select("id, team_code, team_name")
            .in_("id", team_ids)
            .execute()
        )

        team_map = {
            t["id"]: t for t in (teams_response.data or [])
        }

        # 4. Gabungkan data pemain dan Health Point
        result = []

        for member in members:
            player = player_map.get(member["player_id"])
            team = team_map.get(member["team_id"])

            if not player or not team:
                continue

            result.append({
                "player_id": player["id"],
                "username": player["username"],
                "full_name": player["full_name"],
                "team": team["team_name"],
                "team_code": team["team_code"],
                "current_health": member.get("current_health", 100),
                "max_health": member.get("max_health", 100),
                "is_eliminated": member.get("is_eliminated", False),
                "is_healing": member.get("is_healing", False),
                "player_status": member.get("player_status")
            })

        return {
            "success": True,
            "total_players": len(result),
            "players": result
        }

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=str(error)
        )

    # ==========================================
# PLAYER HEALTH UPDATE API
# ==========================================

class HealthUpdate(BaseModel):
    player_id: str
    action: str = Field(pattern="^damage$")
    amount: int = Field(gt=0, le=100)


@app.post("/api/matches/{match_id}/health/update")
def update_player_health(match_id: str, data: HealthUpdate):
    try:
        # 1. Pastikan pertandingan sedang aktif
        match_response = (
            supabase.table("matches")
            .select("id, status")
            .eq("id", match_id)
            .limit(1)
            .execute()
        )

        if not match_response.data:
            raise HTTPException(
                status_code=404,
                detail="Pertandingan tidak ditemukan"
            )

        if match_response.data[0]["status"] != "active":
            raise HTTPException(
                status_code=400,
                detail="Pertandingan belum aktif"
            )

        # 2. Ambil data pemain dalam pertandingan
        member_response = (
            supabase.table("match_players")
            .select("*")
            .eq("match_id", match_id)
            .eq("player_id", data.player_id)
            .limit(1)
            .execute()
        )

        if not member_response.data:
            raise HTTPException(
                status_code=404,
                detail="Pemain tidak ditemukan dalam pertandingan"
            )

        member = member_response.data[0]

        if member.get("is_eliminated"):
            raise HTTPException(
                status_code=400,
                detail="Pemain sudah tereliminasi"
            )

        # 3. Hitung HP baru
        current_hp = member.get("current_health") or 0
        max_hp = member.get("max_health") or 100

        # Endpoint ini khusus damage. Healing wajib melalui endpoint /heal
        # agar durasi 5 detik dan validasi healing selalu diterapkan.
        new_hp = max(0, current_hp - data.amount)

        # 4. Periksa eliminasi
        eliminated = new_hp <= 0

        update_data = {
            "current_health": new_hp,
            "is_eliminated": eliminated
        }

        if eliminated:
            update_data["player_status"] = "eliminated"

        # 5. Simpan perubahan ke database
        update_response = (
            supabase.table("match_players")
            .update(update_data)
            .eq("match_id", match_id)
            .eq("player_id", data.player_id)
            .execute()
        )

        if not update_response.data:
            raise Exception("Gagal memperbarui Health Point")

        return {
            "success": True,
            "message": "Health pemain berhasil diperbarui",
            "action": data.action,
            "current_health": new_hp,
            "max_health": max_hp,
            "is_eliminated": eliminated
        }

    except HTTPException:
        raise

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=str(error)
        )

# ==========================================
# PLAYER HEALING API
# ==========================================

class PlayerHealRequest(BaseModel):
    player_id: str


@app.post("/api/matches/{match_id}/heal")
async def heal_player(match_id: str, data: PlayerHealRequest):
    """Memulihkan 20 HP setelah proses healing selama 5 detik."""
    healing_started = False

    try:
        # 1. Pastikan pertandingan sedang aktif
        match_response = (
            supabase.table("matches")
            .select("id, status")
            .eq("id", match_id)
            .limit(1)
            .execute()
        )

        if not match_response.data:
            raise HTTPException(status_code=404, detail="Pertandingan tidak ditemukan")

        if match_response.data[0]["status"] != "active":
            raise HTTPException(status_code=400, detail="Pertandingan belum aktif")

        # 2. Ambil data pemain dalam pertandingan
        member_response = (
            supabase.table("match_players")
            .select("*")
            .eq("match_id", match_id)
            .eq("player_id", data.player_id)
            .limit(1)
            .execute()
        )

        if not member_response.data:
            raise HTTPException(status_code=404, detail="Pemain tidak ditemukan dalam pertandingan")

        member = member_response.data[0]
        current_hp = member.get("current_health") if member.get("current_health") is not None else 100
        max_hp = member.get("max_health") or 100

        if member.get("is_eliminated") or current_hp <= 0:
            raise HTTPException(status_code=400, detail="Pemain sudah tereliminasi dan tidak bisa healing")

        if current_hp >= max_hp:
            raise HTTPException(status_code=400, detail="Health pemain sudah maksimal")

        if member.get("is_healing"):
            raise HTTPException(status_code=409, detail="Pemain sedang melakukan healing")

        # 3. Tandai proses healing. Kondisi is_healing=false mencegah
        # dua permintaan healing berjalan bersamaan untuk pemain yang sama.
        start_response = (
            supabase.table("match_players")
            .update({"is_healing": True})
            .eq("match_id", match_id)
            .eq("player_id", data.player_id)
            .eq("is_healing", False)
            .eq("is_eliminated", False)
            .execute()
        )

        if not start_response.data:
            raise HTTPException(status_code=409, detail="Healing tidak dapat dimulai. Periksa status pemain.")

        healing_started = True

        # 4. Durasi healing 5 detik (tanpa AI/gesture detection)
        await asyncio.sleep(5)

        # 5. Pastikan pertandingan masih aktif dan pemain belum tereliminasi
        latest_match = (
            supabase.table("matches")
            .select("status")
            .eq("id", match_id)
            .limit(1)
            .execute()
        )

        latest_member = (
            supabase.table("match_players")
            .select("current_health, max_health, is_eliminated")
            .eq("match_id", match_id)
            .eq("player_id", data.player_id)
            .limit(1)
            .execute()
        )

        if not latest_match.data or latest_match.data[0]["status"] != "active":
            raise HTTPException(status_code=400, detail="Pertandingan sudah tidak aktif. Healing dibatalkan.")

        if not latest_member.data:
            raise HTTPException(status_code=404, detail="Data pemain tidak ditemukan setelah healing")

        latest = latest_member.data[0]
        latest_hp = latest.get("current_health") if latest.get("current_health") is not None else 100
        latest_max_hp = latest.get("max_health") or 100

        if latest.get("is_eliminated") or latest_hp <= 0:
            raise HTTPException(status_code=400, detail="Pemain tereliminasi saat proses healing. Healing dibatalkan.")

        # 6. Tambahkan 20 HP, maksimal 100 HP
        new_hp = min(latest_max_hp, latest_hp + 20)

        update_response = (
            supabase.table("match_players")
            .update({
                "current_health": new_hp,
                "is_healing": False
            })
            .eq("match_id", match_id)
            .eq("player_id", data.player_id)
            .eq("is_eliminated", False)
            .execute()
        )

        if not update_response.data:
            raise HTTPException(status_code=409, detail="Gagal menyelesaikan healing. Status pemain berubah.")

        healing_started = False

        # 7. Catat healing yang berhasil ke game_events
        healed_amount = new_hp - latest_hp

        try:
            supabase.table("game_events").insert({
                "match_id": match_id,
                "actor_player_id": data.player_id,
                "target_player_id": None,
                "event_type": "player_heal",
                "description": f"Pemain berhasil memulihkan {healed_amount} HP",
                "event_data": {
                    "healed_amount": healed_amount,
                    "current_health": new_hp,
                    "max_health": latest_max_hp
                }
            }).execute()

        except Exception as event_error:
            print("HEAL EVENT ERROR:", repr(event_error))

        return {
            "success": True,
            "message": "Healing berhasil diselesaikan",
            "healing_duration_seconds": 5,
            "healed_amount": healed_amount,
            "current_health": new_hp,
            "max_health": latest_max_hp,
            "is_healing": False,
            "is_eliminated": False
        }

    except HTTPException:
        raise

    except Exception as error:
        print("HEALING ERROR:", repr(error))
        raise HTTPException(status_code=500, detail="Terjadi kesalahan saat memproses healing")

    finally:
        # Pastikan indikator healing tidak tertinggal aktif jika proses gagal.
        if healing_started:
            try:
                supabase.table("match_players").update({"is_healing": False})\
                    .eq("match_id", match_id)\
                    .eq("player_id", data.player_id)\
                    .execute()
            except Exception as cleanup_error:
                print("HEALING CLEANUP ERROR:", repr(cleanup_error))


# ==========================================
# PLAYER SHOOT API
# ==========================================

class PlayerShootRequest(BaseModel):
    player_id: str = Field(min_length=1)


@app.post("/api/matches/{match_id}/shoot")
def shoot_player(match_id: str, data: PlayerShootRequest):
    try:
        # 1. Pastikan pertandingan tersedia dan sedang aktif
        match_response = (
            supabase.table("matches")
            .select("id, status")
            .eq("id", match_id)
            .limit(1)
            .execute()
        )

        if not match_response.data:
            raise HTTPException(status_code=404, detail="Pertandingan tidak ditemukan")

        if match_response.data[0].get("status") != "active":
            raise HTTPException(status_code=400, detail="Pertandingan belum aktif")

        # 2. Pastikan pemain terdaftar di pertandingan
        member_response = (
            supabase.table("match_players")
            .select("player_id, current_health, is_eliminated")
            .eq("match_id", match_id)
            .eq("player_id", data.player_id)
            .limit(1)
            .execute()
        )

        if not member_response.data:
            raise HTTPException(status_code=403, detail="Pemain tidak tergabung dalam pertandingan")

        member = member_response.data[0]
        if member.get("is_eliminated") or (member.get("current_health") is not None and member.get("current_health") <= 0):
            raise HTTPException(status_code=400, detail="Pemain sudah tereliminasi dan tidak dapat menembak")

        # 3. Ambil identitas pemain untuk deskripsi Event Log
        player_response = (
            supabase.table("players")
            .select("username, full_name")
            .eq("id", data.player_id)
            .limit(1)
            .execute()
        )
        player_name = "Pemain"
        if player_response.data:
            profile = player_response.data[0]
            player_name = profile.get("full_name") or profile.get("username") or "Pemain"

        # 4. Catat aktivitas tembakan (bukan hit yang berhasil)
        event_response = (
            supabase.table("game_events")
            .insert({
                "match_id": match_id,
                "actor_player_id": data.player_id,
                "target_player_id": None,
                "event_type": "player_shot",
                "description": f"{player_name} melakukan tembakan",
                "event_data": {"action": "shoot"}
            })
            .execute()
        )

        return {
            "success": True,
            "message": "Aktivitas tembakan berhasil dicatat",
            "event": event_response.data[0] if event_response.data else None
        }

    except HTTPException:
        raise
    except Exception as error:
        print("SHOOT ERROR:", repr(error))
        raise HTTPException(status_code=500, detail="Gagal mencatat aktivitas tembakan")


# ==========================================
# MATCH EVENT LOG API
# ==========================================

@app.get("/api/matches/{match_id}/events")
def get_match_events(match_id: str):
    try:
        # 1. Pastikan pertandingan tersedia
        match_response = (
            supabase.table("matches")
            .select("id")
            .eq("id", match_id)
            .limit(1)
            .execute()
        )

        if not match_response.data:
            raise HTTPException(
                status_code=404,
                detail="Pertandingan tidak ditemukan"
            )

        # 2. Ambil 50 aktivitas terbaru pertandingan
        events_response = (
            supabase.table("game_events")
            .select("*")
            .eq("match_id", match_id)
            .order("created_at", desc=True)
            .limit(50)
            .execute()
        )

        events = events_response.data or []

        # 3. Kirim hasil ke frontend
        return {
            "success": True,
            "match_id": match_id,
            "total_events": len(events),
            "events": events
        }

    except HTTPException:
        raise

    except Exception as error:
        print("EVENT LOG ERROR:", repr(error))

        raise HTTPException(
            status_code=500,
            detail="Gagal mengambil riwayat aktivitas pertandingan"
        )


# ==========================================
# DELETE MATCH EVENT LOG API
# ==========================================

@app.delete("/api/matches/{match_id}/events")
def delete_match_events(match_id: str):
    try:
        match_response = (
            supabase.table("matches")
            .select("id")
            .eq("id", match_id)
            .limit(1)
            .execute()
        )

        if not match_response.data:
            raise HTTPException(
                status_code=404,
                detail="Pertandingan tidak ditemukan"
            )

        delete_response = (
            supabase.table("game_events")
            .delete()
            .eq("match_id", match_id)
            .select("id")
            .execute()
        )

        return {
            "success": True,
            "message": "Event Log berhasil dibersihkan",
            "deleted_events": len(delete_response.data or [])
        }

    except HTTPException:
        raise

    except Exception as error:
        print("DELETE EVENT ERROR:", repr(error))

        raise HTTPException(
            status_code=500,
            detail="Gagal menghapus Event Log"
        )

# ==========================================
# PLAYER ANALYTICS API
# ==========================================

@app.get("/api/matches/{match_id}/analytics")
def get_player_analytics(match_id: str):
    try:
        # 1. Pastikan pertandingan tersedia
        match_response = (
            supabase.table("matches")
            .select("id")
            .eq("id", match_id)
            .limit(1)
            .execute()
        )

        if not match_response.data:
            raise HTTPException(
                status_code=404,
                detail="Pertandingan tidak ditemukan"
            )

        # 2. Ambil seluruh pemain dalam pertandingan
        members_response = (
            supabase.table("match_players")
            .select("player_id, team_id")
            .eq("match_id", match_id)
            .execute()
        )

        members = members_response.data or []

        if not members:
            return {
                "success": True,
                "match_id": match_id,
                "total_players": 0,
                "players": []
            }

        player_ids = list(set(
            member["player_id"] for member in members
        ))

        team_ids = list(set(
            member["team_id"] for member in members
        ))

        # 3. Ambil profil pemain
        players_response = (
            supabase.table("players")
            .select("id, username, full_name")
            .in_("id", player_ids)
            .execute()
        )

        player_map = {
            player["id"]: player
            for player in (players_response.data or [])
        }

        # 4. Ambil data tim
        teams_response = (
            supabase.table("teams")
            .select("id, team_name, team_code")
            .in_("id", team_ids)
            .execute()
        )

        team_map = {
            team["id"]: team
            for team in (teams_response.data or [])
        }

        # 5. Ambil event pertandingan
        events_response = (
            supabase.table("game_events")
            .select("*")
            .eq("match_id", match_id)
            .order("created_at", desc=True)
            .execute()
        )

        events = events_response.data or []

        # 6. Siapkan statistik setiap pemain
        analytics = {}

        for member in members:
            player_id = member["player_id"]
            player = player_map.get(player_id)
            team = team_map.get(member["team_id"])

            if not player or not team:
                continue

            analytics[player_id] = {
                "player_id": player_id,
                "username": player["username"],
                "full_name": player["full_name"],
                "team": team["team_name"],
                "team_code": team["team_code"],
                "total_shots": 0,
                "total_hit_given": 0,
                "total_hit_received": 0,
                "total_heal": 0,
                "total_steps": 0,
                "distance_meters": 0
            }

        # 7. Hitung statistik dari event
        movement_recorded = set()

        for event in events:
            actor_id = event.get("actor_player_id")
            target_id = event.get("target_player_id")
            event_type = event.get("event_type")
            event_data = event.get("event_data") or {}

            # Total tembakan: hit maupun miss.
            if event_type == "player_shot":
                if actor_id in analytics:
                    analytics[actor_id]["total_shots"] += 1

            # Hit: satu event player_hit mewakili
            # satu tembakan yang berhasil mengenai lawan.
            elif event_type == "player_hit":
                if actor_id in analytics:
                    analytics[actor_id]["total_hit_given"] += 1

                if target_id in analytics:
                    analytics[target_id]["total_hit_received"] += 1

            # Healing berhasil
            elif event_type == "player_heal":
                if actor_id in analytics:
                    analytics[actor_id]["total_heal"] += 1

            # Movement: gunakan snapshot terbaru per pemain
            elif event_type == "player_movement":
                if actor_id in analytics and actor_id not in movement_recorded:
                    analytics[actor_id]["total_steps"] = event_data.get(
                        "total_steps", 0
                    )

                    analytics[actor_id]["distance_meters"] = event_data.get(
                        "distance_meters", 0
                    )

                    movement_recorded.add(actor_id)

        return {
            "success": True,
            "match_id": match_id,
            "total_players": len(analytics),
            "players": list(analytics.values())
        }

    except HTTPException:
        raise

    except Exception as error:
        print("PLAYER ANALYTICS ERROR:", repr(error))

        raise HTTPException(
            status_code=500,
            detail="Gagal mengambil data Player Analytics"
        )