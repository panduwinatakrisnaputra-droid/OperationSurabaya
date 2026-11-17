
import os
import asyncio
import secrets

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from supabase import create_client, Client
from pydantic import BaseModel, Field
from datetime import datetime, timezone, timedelta

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

@app.post("/api/matches/{match_id}/join")
def select_team(match_id: str, selection: TeamSelection):
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
            raise HTTPException(404, "Room tidak ditemukan")

        match = match_response.data[0]

        if match["status"] != "waiting":
            raise HTTPException(
                400, "Room sudah tidak menerima pemain"
            )

        # 2. Periksa pemain
        player_response = (
            supabase.table("players")
            .select("id, username, full_name, status")
            .eq("id", selection.player_id)
            .limit(1)
            .execute()
        )

        if not player_response.data:
            raise HTTPException(404, "Pemain tidak ditemukan")

        # 3. Periksa tim tujuan
        team_response = (
            supabase.table("teams")
            .select("id, team_code, team_name, team_color")
            .eq("team_code", selection.team_code)
            .limit(1)
            .execute()
        )

        if not team_response.data:
            raise HTTPException(404, "Tim tidak ditemukan")

        team = team_response.data[0]

        # 4. Ambil anggota room
        members_response = (
            supabase.table("match_players")
            .select("id, player_id, team_id")
            .eq("match_id", match_id)
            .execute()
        )

        members = members_response.data or []

        # 5. Periksa keanggotaan pemain
        existing = next(
            (
                member for member in members
                if member["player_id"] == selection.player_id
            ),
            None
        )

        # 6. Hitung jumlah pemain di tim tujuan
        team_members = [
            member for member in members
            if member["team_id"] == team["id"]
            and member["player_id"] != selection.player_id
        ]

        team_capacity = (
            match["red_capacity"]
            if selection.team_code == "RED"
            else match["blue_capacity"]
        )

        if len(team_members) >= team_capacity:
            # Pemain yang sudah berada di tim tersebut
            # tetap boleh mengakses room
            if not existing or existing["team_id"] != team["id"]:
                raise HTTPException(
                    400,
                    f"{team['team_name']} sudah penuh"
                )

        # 7. Masukkan pemain atau perbarui tim
        if existing:
            result = (
                supabase.table("match_players")
                .update({"team_id": team["id"]})
                .eq("match_id", match_id)
                .eq("player_id", selection.player_id)
                .execute()
            )
        else:
            result = (
                supabase.table("match_players")
                .insert({
                    "match_id": match_id,
                    "player_id": selection.player_id,
                    "team_id": team["id"],
                    "player_status": "joined",
                    "is_host": False
                })
                .execute()
            )

        return {
            "success": True,
            "message": f"Berhasil bergabung ke {team['team_name']}",
            "match_id": match_id,
            "player": player_response.data[0],
            "team": team,
            "team_total": len(team_members) + 1,
            "team_capacity": team_capacity,
            "data": result.data
        }

    except HTTPException:
        raise

    except Exception as error:
        print("JOIN ROOM ERROR:", repr(error))
        raise HTTPException(
            status_code=500,
            detail=str(error)
        )

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
                "ghost_mode_until": member.get("ghost_mode_until"),
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

        # Ghost Mode memberikan kekebalan penuh terhadap damage, tanpa melarang pemain menembak.
        ghost_until = member.get("ghost_mode_until")
        if ghost_until:
            try:
                ghost_expiry = datetime.fromisoformat(str(ghost_until).replace("Z", "+00:00"))
                if ghost_expiry > datetime.now(timezone.utc):
                    remaining = max(1, int((ghost_expiry - datetime.now(timezone.utc)).total_seconds()))
                    return {
                        "success": True,
                        "message": "Serangan tidak memberikan damage karena Ghost Mode aktif",
                        "player_id": data.player_id,
                        "current_health": member.get("current_health", 100),
                        "damage_applied": 0,
                        "blocked_by_ghost_mode": True,
                        "ghost_mode_until": ghost_until,
                        "ghost_mode_remaining_seconds": remaining
                    }
            except (TypeError, ValueError):
                # Timestamp yang tidak valid tidak boleh membuat pemain kebal tanpa batas.
                pass

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
# PLAYER HEALING API - BASE QR + POSE VALIDATION
# ==========================================

class PlayerHealRequest(BaseModel):
    player_id: str = Field(min_length=1)
    qr_payload: str = Field(min_length=1, max_length=300)
    pose_verified: bool = False


@app.post("/api/matches/{match_id}/heal")
def heal_player(match_id: str, data: PlayerHealRequest):
    """Memulihkan HP setelah QR base tervalidasi dan pose detection menyatakan pose benar."""
    try:
        match_response = (supabase.table("matches").select("id, status")
            .eq("id", match_id).limit(1).execute())
        if not match_response.data:
            raise HTTPException(status_code=404, detail="Pertandingan tidak ditemukan")
        if match_response.data[0].get("status") != "active":
            raise HTTPException(status_code=400, detail="Healing hanya tersedia saat pertandingan aktif")

        prefix = "OPS-HEALING:"
        payload = data.qr_payload.strip()
        if not payload.startswith(prefix):
            raise HTTPException(status_code=400, detail="QR Code bukan QR Healing Base")
        station_code = payload[len(prefix):].strip()
        if not station_code:
            raise HTTPException(status_code=400, detail="Kode Healing Station tidak valid")

        station_response = (supabase.table("healing_stations")
            .select("station_code, station_name, team_code, heal_amount, is_active")
            .eq("station_code", station_code).limit(1).execute())
        if not station_response.data or not station_response.data[0].get("is_active"):
            raise HTTPException(status_code=404, detail="Healing Station tidak ditemukan atau nonaktif")
        station = station_response.data[0]

        member_response = (supabase.table("match_players")
            .select("player_id, team_id, player_status, current_health, max_health, is_eliminated, is_healing")
            .eq("match_id", match_id).eq("player_id", data.player_id).limit(1).execute())
        if not member_response.data:
            raise HTTPException(status_code=403, detail="Pemain tidak tergabung dalam pertandingan")
        member = member_response.data[0]

        team_response = (supabase.table("teams").select("team_code")
            .eq("id", member.get("team_id")).limit(1).execute())
        if not team_response.data:
            raise HTTPException(status_code=400, detail="Tim pemain tidak dapat diverifikasi")
        player_team = str(team_response.data[0].get("team_code", "")).upper()
        if player_team != str(station.get("team_code", "")).upper():
            raise HTTPException(status_code=403, detail="Healing hanya dapat dilakukan di base tim sendiri")

        current_hp = member.get("current_health") if member.get("current_health") is not None else 100
        max_hp = member.get("max_health") or 100
        if member.get("is_eliminated") or member.get("player_status") == "eliminated" or current_hp <= 0:
            raise HTTPException(status_code=400, detail="Pemain tereliminasi dan tidak bisa healing")
        if current_hp >= max_hp:
            raise HTTPException(status_code=400, detail="Health pemain sudah maksimal")
        if member.get("is_healing"):
            raise HTTPException(status_code=409, detail="Pemain sedang melakukan healing")
        if not data.pose_verified:
            raise HTTPException(status_code=400, detail="Pose healing belum berhasil divalidasi")

        # Kunci status untuk mencegah dua proses healing bersamaan.
        lock_response = (supabase.table("match_players").update({"is_healing": True})
            .eq("match_id", match_id).eq("player_id", data.player_id)
            .eq("is_healing", False).eq("is_eliminated", False).execute())
        if not lock_response.data:
            raise HTTPException(status_code=409, detail="Healing tidak dapat dimulai. Periksa status pemain.")

        amount = max(1, min(int(station.get("heal_amount") or 20), 100))
        new_hp = min(max_hp, current_hp + amount)
        update_response = (supabase.table("match_players")
            .update({"current_health": new_hp, "is_healing": False})
            .eq("match_id", match_id).eq("player_id", data.player_id)
            .eq("is_eliminated", False).execute())
        if not update_response.data:
            supabase.table("match_players").update({"is_healing": False}).eq("match_id", match_id).eq("player_id", data.player_id).execute()
            raise HTTPException(status_code=409, detail="Gagal menyelesaikan healing")

        healed_amount = new_hp - current_hp
        try:
            supabase.table("game_events").insert({
                "match_id": match_id, "actor_player_id": data.player_id,
                "event_type": "player_heal",
                "description": f"Pemain memulihkan {healed_amount} HP di base {player_team}",
                "event_data": {"station_code": station_code, "team_code": player_team,
                    "healed_amount": healed_amount, "current_health": new_hp, "max_health": max_hp,
                    "pose_verified": True}
            }).execute()
        except Exception as event_error:
            print("HEAL EVENT ERROR:", repr(event_error))

        return {"success": True, "message": f"Healing berhasil! +{healed_amount} HP",
            "station_code": station_code, "healed_amount": healed_amount,
            "current_health": new_hp, "max_health": max_hp, "is_healing": False}
    except HTTPException:
        raise
    except Exception as error:
        print("HEALING ERROR:", repr(error))
        raise HTTPException(status_code=500, detail="Terjadi kesalahan saat memproses healing")


# ==========================================


# ==========================================
# BASE SHUTDOWN API
# ==========================================
class BaseShutdownRequest(BaseModel):
    player_id: str = Field(min_length=1)
    qr_payload: str = Field(min_length=1, max_length=300)

@app.post("/api/matches/{match_id}/base-shutdown/start")
def start_base_shutdown(match_id: str, data: BaseShutdownRequest):
    """Validasi awal dan umumkan ancaman shutdown ke tim pemilik base."""
    try:
        match_res = supabase.table("matches").select("id,status").eq("id", match_id).limit(1).execute()
        if not match_res.data:
            raise HTTPException(status_code=404, detail="Pertandingan tidak ditemukan")
        if match_res.data[0].get("status") != "active":
            raise HTTPException(status_code=400, detail="Pertandingan tidak aktif atau sudah berakhir")

        payload = data.qr_payload.strip()
        prefix = "OPS-BASE-SHUTDOWN:"
        if not payload.startswith(prefix):
            raise HTTPException(status_code=400, detail="QR bukan QR Base Shutdown")
        station_code = payload[len(prefix):].strip()
        station_res = supabase.table("base_shutdown_stations").select("station_code,team_code,is_active").eq("station_code", station_code).limit(1).execute()
        if not station_res.data or not station_res.data[0].get("is_active"):
            raise HTTPException(status_code=404, detail="QR Base Shutdown tidak ditemukan atau nonaktif")

        member_res = supabase.table("match_players").select("player_id,team_id,player_status,is_eliminated,current_health").eq("match_id", match_id).eq("player_id", data.player_id).limit(1).execute()
        if not member_res.data:
            raise HTTPException(status_code=403, detail="Pemain tidak tergabung dalam pertandingan")
        member = member_res.data[0]
        team_res = supabase.table("teams").select("team_code").eq("id", member.get("team_id")).limit(1).execute()
        if not team_res.data:
            raise HTTPException(status_code=400, detail="Tim pemain tidak dapat diverifikasi")

        attacker = str(team_res.data[0].get("team_code", "")).upper()
        defender = str(station_res.data[0].get("team_code", "")).upper()
        if attacker not in ("RED", "BLUE") or defender not in ("RED", "BLUE"):
            raise HTTPException(status_code=400, detail="Identitas tim tidak valid")
        if attacker == defender:
            raise HTTPException(status_code=403, detail="Kamu tidak dapat menonaktifkan base tim sendiri")
        if member.get("is_eliminated") or member.get("player_status") == "eliminated" or (member.get("current_health") or 0) <= 0:
            raise HTTPException(status_code=400, detail="Pemain tereliminasi tidak dapat melakukan shutdown")

        event = supabase.table("game_events").insert({
            "match_id": match_id,
            "actor_player_id": data.player_id,
            "event_type": "base_shutdown_started",
            "description": f"Tim {attacker} memulai proses shutdown Base {defender}",
            "event_data": {
                "station_code": station_code,
                "attacker_team_code": attacker,
                "defender_team_code": defender,
                "duration_seconds": 60
            }
        }).execute()
        return {"success": True, "message": f"Proses shutdown Base {defender} dimulai", "attacker_team_code": attacker, "defender_team_code": defender, "event": event.data[0] if event.data else None}
    except HTTPException:
        raise
    except Exception as error:
        print("BASE SHUTDOWN START ERROR:", repr(error))
        raise HTTPException(status_code=500, detail="Gagal memulai proses Base Shutdown")


@app.post("/api/matches/{match_id}/base-shutdown/complete")
def complete_base_shutdown(match_id: str, data: BaseShutdownRequest):
    """Finalisasi shutdown base setelah countdown di Player Portal selesai."""
    try:
        match_res = supabase.table("matches").select("id,status,winner_team_code").eq("id", match_id).limit(1).execute()
        if not match_res.data: raise HTTPException(status_code=404, detail="Pertandingan tidak ditemukan")
        if match_res.data[0].get("status") != "active": raise HTTPException(status_code=400, detail="Pertandingan tidak aktif atau sudah berakhir")
        prefix = "OPS-BASE-SHUTDOWN:"; payload = data.qr_payload.strip()
        if not payload.startswith(prefix): raise HTTPException(status_code=400, detail="QR bukan QR Base Shutdown")
        station_code = payload[len(prefix):].strip()
        station_res = supabase.table("base_shutdown_stations").select("station_code,team_code,is_active").eq("station_code", station_code).limit(1).execute()
        if not station_res.data or not station_res.data[0].get("is_active"): raise HTTPException(status_code=404, detail="QR Base Shutdown tidak ditemukan atau nonaktif")
        station = station_res.data[0]
        member_res = supabase.table("match_players").select("player_id,team_id,player_status,is_eliminated,current_health").eq("match_id",match_id).eq("player_id",data.player_id).limit(1).execute()
        if not member_res.data: raise HTTPException(status_code=403, detail="Pemain tidak tergabung dalam pertandingan")
        member=member_res.data[0]
        team_res=supabase.table("teams").select("team_code").eq("id",member.get("team_id")).limit(1).execute()
        if not team_res.data: raise HTTPException(status_code=400, detail="Tim pemain tidak dapat diverifikasi")
        attacker=str(team_res.data[0].get("team_code","")).upper(); defender=str(station.get("team_code","")).upper()
        if attacker == defender: raise HTTPException(status_code=403, detail="Kamu tidak dapat menonaktifkan base tim sendiri")
        if attacker not in ("RED","BLUE") or defender not in ("RED","BLUE"): raise HTTPException(status_code=400, detail="Identitas tim tidak valid")
        if member.get("is_eliminated") or member.get("player_status")=="eliminated" or (member.get("current_health") or 0)<=0: raise HTTPException(status_code=400, detail="Pemain tereliminasi tidak dapat melakukan shutdown")
        # Unique key match_id prevents two teams/players from completing the same objective twice.
        try:
            supabase.table("base_shutdowns").insert({"match_id":match_id,"station_code":station_code,"attacker_team_code":attacker,"defender_team_code":defender,"player_id":data.player_id,"status":"completed"}).execute()
        except Exception:
            raise HTTPException(status_code=409, detail="Base sudah dinonaktifkan atau proses shutdown sudah diselesaikan")
        update=supabase.table("matches").update({"status":"completed","ended_at":datetime.now(timezone.utc).isoformat(),"winner_team_code":attacker}).eq("id",match_id).eq("status","active").execute()
        if not update.data: raise HTTPException(status_code=409, detail="Pertandingan sudah diselesaikan oleh proses lain")
        supabase.table("game_events").insert({"match_id":match_id,"actor_player_id":data.player_id,"event_type":"base_shutdown_success","description":f"Tim {attacker} berhasil menonaktifkan base {defender} dan memenangkan pertandingan","event_data":{"station_code":station_code,"attacker_team_code":attacker,"defender_team_code":defender}}).execute()
        return {"success":True,"message":f"BASE {defender} BERHASIL DINONAKTIFKAN. TIM {attacker} MENANG!","winner_team_code":attacker,"defeated_team_code":defender,"match_status":"completed"}
    except HTTPException: raise
    except Exception as error:
        print("BASE SHUTDOWN ERROR:",repr(error));raise HTTPException(status_code=500,detail="Terjadi kesalahan saat memproses Base Shutdown")


# PLAYER GHOST MODE API
# ==========================================

class GhostModeScanRequest(BaseModel):
    player_id: str = Field(min_length=1)
    qr_payload: str = Field(min_length=1, max_length=300)


@app.post("/api/matches/{match_id}/ghost-mode/scan")
def activate_ghost_mode_qr(match_id: str, data: GhostModeScanRequest):
    """Aktifkan Ghost Mode melalui QR treasure; satu kali per pemain per pertandingan."""
    try:
        match_response = (supabase.table("matches").select("id, status")
            .eq("id", match_id).limit(1).execute())
        if not match_response.data:
            raise HTTPException(status_code=404, detail="Pertandingan tidak ditemukan")
        if match_response.data[0].get("status") != "active":
            raise HTTPException(status_code=400, detail="Ghost Mode hanya dapat diambil saat pertandingan aktif")

        prefix = "OPS-GHOST-MODE:"
        payload = data.qr_payload.strip()
        if not payload.startswith(prefix):
            raise HTTPException(status_code=400, detail="QR Code bukan QR Treasure Ghost Mode")
        station_code = payload[len(prefix):].strip()
        if not station_code or len(station_code) > 80:
            raise HTTPException(status_code=400, detail="Kode treasure tidak valid")

        station_response = (supabase.table("ghost_mode_stations")
            .select("station_code, station_name, duration_seconds, is_active")
            .eq("station_code", station_code).limit(1).execute())
        if not station_response.data or not station_response.data[0].get("is_active"):
            raise HTTPException(status_code=404, detail="Treasure Ghost Mode tidak ditemukan atau nonaktif")
        station = station_response.data[0]

        member_response = (supabase.table("match_players")
            .select("player_id, player_status, is_eliminated, ghost_mode_until")
            .eq("match_id", match_id).eq("player_id", data.player_id).limit(1).execute())
        if not member_response.data:
            raise HTTPException(status_code=403, detail="Pemain tidak tergabung dalam pertandingan")
        member = member_response.data[0]
        if member.get("is_eliminated") or member.get("player_status") == "eliminated":
            raise HTTPException(status_code=400, detail="Pemain tereliminasi tidak dapat mengambil Ghost Mode")

        now = datetime.now(timezone.utc)
        current_until = member.get("ghost_mode_until")
        if current_until:
            try:
                expiry = datetime.fromisoformat(str(current_until).replace("Z", "+00:00"))
                if expiry > now:
                    raise HTTPException(status_code=409, detail="Ghost Mode masih aktif")
            except ValueError:
                pass

        # Unique constraint pada tabel scan mencegah QR treasure dipakai ulang pemain yang sama.
        try:
            supabase.table("ghost_mode_scans").insert({
                "match_id": match_id, "player_id": data.player_id, "station_code": station_code
            }).execute()
        except Exception:
            raise HTTPException(status_code=409, detail="Treasure Ghost Mode ini sudah pernah diambil pada pertandingan ini")

        duration = max(1, min(int(station.get("duration_seconds") or 30), 3600))
        expires_at = now + timedelta(seconds=duration)
        update_response = (supabase.table("match_players")
            .update({"ghost_mode_until": expires_at.isoformat()})
            .eq("match_id", match_id).eq("player_id", data.player_id).execute())
        if not update_response.data:
            raise HTTPException(status_code=500, detail="Gagal mengaktifkan Ghost Mode")

        supabase.table("game_events").insert({
            "match_id": match_id,
            "actor_player_id": data.player_id,
            "event_type": "ghost_mode_activated",
            "description": f"Pemain mengaktifkan Ghost Mode selama {duration} detik",
            "event_data": {"station_code": station_code, "duration_seconds": duration, "ghost_mode_until": expires_at.isoformat()}
        }).execute()

        return {
            "success": True,
            "message": f"Ghost Mode aktif selama {duration} detik! Kamu kebal terhadap serangan.",
            "player_id": data.player_id,
            "duration_seconds": duration,
            "ghost_mode_until": expires_at.isoformat()
        }
    except HTTPException:
        raise
    except Exception as error:
        print("GHOST MODE ERROR:", repr(error))
        raise HTTPException(status_code=500, detail="Terjadi kesalahan saat mengaktifkan Ghost Mode")


# ==========================================
# PLAYER WEAPON API
# ==========================================

WEAPON_DAMAGE_BY_LEVEL = {1: 10, 2: 15, 3: 20, 4: 25}

@app.get("/api/matches/{match_id}/weapon/{player_id}")
def get_player_weapon(match_id: str, player_id: str):
    try:
        match_response = (supabase.table("matches").select("id, status")
            .eq("id", match_id).limit(1).execute())
        if not match_response.data:
            raise HTTPException(status_code=404, detail="Pertandingan tidak ditemukan")

        member_response = (supabase.table("match_players")
            .select("player_id, weapon_level, player_status, is_eliminated")
            .eq("match_id", match_id).eq("player_id", player_id)
            .limit(1).execute())
        if not member_response.data:
            raise HTTPException(status_code=404, detail="Pemain tidak ditemukan dalam pertandingan")

        member = member_response.data[0]
        level = int(member.get("weapon_level") or 1)
        return {
            "success": True,
            "player_id": player_id,
            "weapon_name": f"TACTICAL RIFLE MK-{level}",
            "weapon_level": level,
            "damage": WEAPON_DAMAGE_BY_LEVEL.get(level, 10),
            "available_levels": [
                {"level": key, "damage": value}
                for key, value in WEAPON_DAMAGE_BY_LEVEL.items()
            ]
        }
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=500, detail=str(error))


class WeaponLevelUpdate(BaseModel):
    player_id: str = Field(min_length=1)
    weapon_level: int = Field(ge=1, le=4)


class WeaponUpgradeScanRequest(BaseModel):
    player_id: str = Field(min_length=1)
    qr_payload: str = Field(min_length=1, max_length=300)


@app.post("/api/matches/{match_id}/weapon/upgrade/scan")
def scan_weapon_upgrade_qr(match_id: str, data: WeaponUpgradeScanRequest):
    """Upgrade satu level melalui QR station yang terdaftar; setiap station hanya sekali per pemain per match."""
    try:
        match_response = (supabase.table("matches").select("id, status")
            .eq("id", match_id).limit(1).execute())
        if not match_response.data:
            raise HTTPException(status_code=404, detail="Pertandingan tidak ditemukan")
        if match_response.data[0].get("status") != "active":
            raise HTTPException(status_code=400, detail="Upgrade hanya tersedia saat pertandingan aktif")

        prefix = "OPS-WEAPON-UPGRADE:"
        payload = data.qr_payload.strip()
        if not payload.startswith(prefix):
            raise HTTPException(status_code=400, detail="QR Code bukan QR Weapon Upgrade")
        station_code = payload[len(prefix):].strip()
        if not station_code or len(station_code) > 80:
            raise HTTPException(status_code=400, detail="Kode stasiun tidak valid")

        station_response = (supabase.table("weapon_upgrade_stations")
            .select("station_code, station_name, is_active")
            .eq("station_code", station_code).limit(1).execute())
        if not station_response.data or not station_response.data[0].get("is_active"):
            raise HTTPException(status_code=404, detail="Weapon Upgrade Station tidak ditemukan atau nonaktif")
        station = station_response.data[0]

        member_response = (supabase.table("match_players")
            .select("player_id, weapon_level, player_status, is_eliminated")
            .eq("match_id", match_id).eq("player_id", data.player_id).limit(1).execute())
        if not member_response.data:
            raise HTTPException(status_code=404, detail="Pemain tidak terdaftar dalam pertandingan")
        member = member_response.data[0]
        if member.get("is_eliminated") or member.get("player_status") == "eliminated":
            raise HTTPException(status_code=400, detail="Pemain yang tereliminasi tidak dapat upgrade senjata")

        current_level = int(member.get("weapon_level") or 1)
        if current_level >= 4:
            raise HTTPException(status_code=400, detail="Level senjata sudah maksimum")

        # Catatan unik mencegah pemain memakai QR station yang sama berulang kali.
        try:
            supabase.table("weapon_upgrade_scans").insert({
                "match_id": match_id,
                "player_id": data.player_id,
                "station_code": station_code
            }).execute()
        except Exception:
            raise HTTPException(status_code=409, detail="QR station ini sudah pernah digunakan oleh pemain pada pertandingan ini")

        new_level = current_level + 1
        damage = WEAPON_DAMAGE_BY_LEVEL[new_level]
        update_response = (supabase.table("match_players")
            .update({"weapon_level": new_level})
            .eq("match_id", match_id).eq("player_id", data.player_id).execute())
        if not update_response.data:
            raise HTTPException(status_code=500, detail="Gagal menyimpan level senjata")

        supabase.table("game_events").insert({
            "match_id": match_id,
            "actor_player_id": data.player_id,
            "event_type": "weapon_upgrade",
            "description": f"Pemain upgrade senjata ke Level {new_level} melalui {station.get('station_name') or station_code}",
            "event_data": {
                "station_code": station_code,
                "station_name": station.get("station_name"),
                "previous_level": current_level,
                "weapon_level": new_level,
                "damage": damage,
                "source": "qr_code"
            }
        }).execute()

        return {
            "success": True,
            "message": f"Upgrade berhasil! Senjata sekarang Level {new_level}",
            "player_id": data.player_id,
            "station_code": station_code,
            "weapon_name": f"TACTICAL RIFLE MK-{new_level}",
            "weapon_level": new_level,
            "damage": damage
        }
    except HTTPException:
        raise
    except Exception as error:
        print("WEAPON QR UPGRADE ERROR:", repr(error))
        raise HTTPException(status_code=500, detail="Terjadi kesalahan saat memproses QR upgrade")


@app.patch("/api/admin/matches/{match_id}/weapon")
def admin_update_weapon_level(match_id: str, data: WeaponLevelUpdate):
    """Endpoint kontrol admin untuk pengujian level senjata. Tambahkan autentikasi admin sebelum produksi."""
    try:
        match_response = (supabase.table("matches").select("id, status")
            .eq("id", match_id).limit(1).execute())
        if not match_response.data:
            raise HTTPException(status_code=404, detail="Pertandingan tidak ditemukan")
        if match_response.data[0].get("status") != "active":
            raise HTTPException(status_code=400, detail="Senjata hanya dapat diubah saat pertandingan aktif")

        update_response = (supabase.table("match_players")
            .update({"weapon_level": data.weapon_level})
            .eq("match_id", match_id).eq("player_id", data.player_id).execute())
        if not update_response.data:
            raise HTTPException(status_code=404, detail="Pemain tidak ditemukan dalam pertandingan")

        damage = WEAPON_DAMAGE_BY_LEVEL[data.weapon_level]
        supabase.table("game_events").insert({
            "match_id": match_id,
            "actor_player_id": data.player_id,
            "event_type": "weapon_upgrade",
            "description": f"Level senjata pemain ditetapkan ke Level {data.weapon_level}",
            "event_data": {"weapon_level": data.weapon_level, "damage": damage}
        }).execute()
        return {"success": True, "message": "Level senjata berhasil diperbarui",
                "player_id": data.player_id, "weapon_level": data.weapon_level, "damage": damage}
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=500, detail=str(error))


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
            .select("player_id, current_health, is_eliminated, weapon_level")
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

        # 3. Ambil level senjata dan damage dasar
        weapon_level = int(member.get("weapon_level") or 1)
        weapon_damage = {1: 10, 2: 15, 3: 20, 4: 25}.get(weapon_level, 10)

        # 4. Ambil identitas pemain untuk deskripsi Event Log
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
                "description": f"{player_name} melakukan tembakan (Weapon Lv.{weapon_level})",
                "event_data": {
                    "action": "shoot",
                    "weapon_level": weapon_level,
                    "weapon_damage": weapon_damage,
                    "result": "shot_recorded",
                    "note": "Belum dihitung sebagai hit; menunggu integrasi target detection AI"
                }
            })
            .execute()
        )

        return {
            "success": True,
            "message": "Aktivitas tembakan berhasil dicatat",
            "weapon_level": weapon_level,
            "weapon_damage": weapon_damage,
            "result": "shot_recorded",
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

    
# ==========================================
# ROOM BROWSER API
# ==========================================

@app.get("/api/rooms")
def get_rooms(
    status: str = "all",
    search: str = "",
    page: int = 1,
    page_size: int = 20
):
    try:
        # Validasi parameter
        allowed_status = [
            "all", "waiting", "active",
            "completed", "cancelled"
        ]

        if status not in allowed_status:
            raise HTTPException(
                status_code=400,
                detail="Status room tidak valid"
            )

        if page < 1 or page_size < 1 or page_size > 100:
            raise HTTPException(
                status_code=400,
                detail="Parameter halaman tidak valid"
            )

        # 1. Ambil data room
        query = (
            supabase.table("matches")
            .select("*", count="exact")
            .order("created_at", desc=True)
        )

        if status != "all":
            query = query.eq("status", status)

        if search.strip():
            keyword = search.strip().replace(",", "")
            query = query.or_(
                f"match_name.ilike.%{keyword}%,"
                f"room_code.ilike.%{keyword}%"
            )

        start = (page - 1) * page_size
        end = start + page_size - 1

        response = query.range(start, end).execute()

        matches = response.data or []
        total_rooms = response.count or 0

        if not matches:
            return {
                "success": True,
                "total_rooms": total_rooms,
                "page": page,
                "page_size": page_size,
                "data": []
            }

        # 2. Ambil ID pertandingan
        match_ids = [m["id"] for m in matches]

        # 3. Ambil seluruh anggota room
        members_response = (
            supabase.table("match_players")
            .select("match_id, team_id")
            .in_("match_id", match_ids)
            .execute()
        )

        members = members_response.data or []

        # 4. Ambil identitas tim
        teams_response = (
            supabase.table("teams")
            .select("id, team_code")
            .execute()
        )

        teams = teams_response.data or []

        team_map = {
            team["id"]: team["team_code"]
            for team in teams
        }

        # 5. Hitung anggota setiap room
        room_counts = {}

        for match in matches:
            room_counts[match["id"]] = {
                "red": 0,
                "blue": 0
            }

        for member in members:
            match_id = member["match_id"]
            team_code = team_map.get(member["team_id"])

            if match_id not in room_counts:
                continue

            if team_code == "RED":
                room_counts[match_id]["red"] += 1

            elif team_code == "BLUE":
                room_counts[match_id]["blue"] += 1

        # 6. Gabungkan informasi room
        room_data = []

        for match in matches:
            counts = room_counts[match["id"]]

            red_count = counts["red"]
            blue_count = counts["blue"]

            red_capacity = match.get("red_capacity", 0)
            blue_capacity = match.get("blue_capacity", 0)

            room_data.append({
                "id": match["id"],
                "match_name": match["match_name"],
                "room_code": match.get("room_code"),
                "status": match["status"],
                "arena_name": match.get("arena_name"),
                "duration_hours": match.get("duration_hours"),

                "red_team": {
                    "total": red_count,
                    "capacity": red_capacity,
                    "available": max(
                        0, red_capacity - red_count
                    )
                },

                "blue_team": {
                    "total": blue_count,
                    "capacity": blue_capacity,
                    "available": max(
                        0, blue_capacity - blue_count
                    )
                },

                "total_players": red_count + blue_count,
                "max_players": match["max_players"],

                "created_at": match["created_at"]
            })

        return {
            "success": True,
            "total_rooms": total_rooms,
            "page": page,
            "page_size": page_size,
            "total_pages": (
                (total_rooms + page_size - 1) // page_size
            ),
            "data": room_data
        }

    except HTTPException:
        raise

    except Exception as error:
        print("ROOM BROWSER ERROR:", repr(error))

        raise HTTPException(
            status_code=500,
            detail="Gagal mengambil daftar room"
        )

# ==========================================
# CREATE ROOM API
# ==========================================

class CreateRoomRequest(BaseModel):
    match_name: str = Field(min_length=3, max_length=100)
    host_player_id: str
    team_code: str = Field(pattern="^(RED|BLUE)$")
    red_capacity: int = Field(ge=1, le=50)
    blue_capacity: int = Field(ge=1, le=50)
    duration_hours: float = Field(gt=0, le=24)
    arena_name: str = Field(min_length=2, max_length=100)


@app.post("/api/rooms/create")
def create_room(data: CreateRoomRequest):
    created_match_id = None

    try:
        # 1. Periksa Host
        player_response = (
            supabase.table("players")
            .select("id, username, full_name, email")
            .eq("id", data.host_player_id)
            .limit(1)
            .execute()
        )

        if not player_response.data:
            raise HTTPException(
                status_code=404,
                detail="Data Host tidak ditemukan"
            )

        host = player_response.data[0]

        # 2. Periksa tim Host
        team_response = (
            supabase.table("teams")
            .select("id, team_code, team_name, team_color")
            .eq("team_code", data.team_code)
            .limit(1)
            .execute()
        )

        if not team_response.data:
            raise HTTPException(
                status_code=404,
                detail="Tim tidak ditemukan"
            )

        team = team_response.data[0]

        # 3. Buat kode room unik
        room_code = None

        for _ in range(10):
            candidate = secrets.token_hex(4).upper()

            check_code = (
                supabase.table("matches")
                .select("id")
                .eq("room_code", candidate)
                .limit(1)
                .execute()
            )

            if not check_code.data:
                room_code = candidate
                break

        if not room_code:
            raise HTTPException(
                status_code=500,
                detail="Gagal membuat kode room unik"
            )

        # 4. Hitung kapasitas total
        max_players = data.red_capacity + data.blue_capacity

        # 5. Buat pertandingan
        match_response = (
            supabase.table("matches")
            .insert({
                "match_name": data.match_name,
                "room_code": room_code,
                "status": "waiting",
                "red_capacity": data.red_capacity,
                "blue_capacity": data.blue_capacity,
                "max_players": max_players,
                "duration_hours": data.duration_hours,
                "arena_name": data.arena_name
            })
            .execute()
        )

        if not match_response.data:
            raise Exception("Gagal membuat room")

        match = match_response.data[0]
        created_match_id = match["id"]

        # 6. Masukkan Host sebagai pemain
        host_response = (
            supabase.table("match_players")
            .insert({
                "match_id": match["id"],
                "player_id": host["id"],
                "team_id": team["id"],
                "player_status": "joined",
                "is_host": True
            })
            .execute()
        )

        if not host_response.data:
            raise Exception("Gagal mendaftarkan Host ke room")

        # 7. Berikan respons
        return {
            "success": True,
            "message": "Room berhasil dibuat",
            "room": {
                "id": match["id"],
                "match_name": match["match_name"],
                "room_code": match["room_code"],
                "status": match["status"],
                "arena_name": match["arena_name"],
                "duration_hours": match["duration_hours"],
                "max_players": match["max_players"],
                "red_capacity": match["red_capacity"],
                "blue_capacity": match["blue_capacity"]
            },
            "host": {
                "player": host,
                "team": team,
                "is_host": True
            }
        }

    except HTTPException:
        raise

    except Exception as error:
        # Hapus room jika pendaftaran Host gagal
        if created_match_id:
            try:
                (
                    supabase.table("matches")
                    .delete()
                    .eq("id", created_match_id)
                    .execute()
                )
            except Exception as cleanup_error:
                print("ROOM CLEANUP ERROR:", repr(cleanup_error))

        print("CREATE ROOM ERROR:", repr(error))

        raise HTTPException(
            status_code=500,
            detail=str(error)
        )

    
# ==========================================
# JOIN ROOM BY CODE API
# ==========================================

class JoinRoomByCodeRequest(BaseModel):
    room_code: str = Field(min_length=8, max_length=8)
    player_id: str
    team_code: str = Field(pattern="^(RED|BLUE)$")


@app.post("/api/rooms/join")
def join_room_by_code(data: JoinRoomByCodeRequest):
    try:
        # 1. Cari room berdasarkan kode
        room_response = (
            supabase.table("matches")
            .select("*")
            .eq("room_code", data.room_code.strip().upper())
            .limit(1)
            .execute()
        )

        if not room_response.data:
            raise HTTPException(
                status_code=404,
                detail="Kode room tidak ditemukan"
            )

        room = room_response.data[0]

        # 2. Pastikan room masih menerima pemain
        if room["status"] != "waiting":
            raise HTTPException(
                status_code=400,
                detail="Room sudah tidak menerima pemain"
            )

        # 3. Gunakan fungsi join yang sudah dibuat
        selection = TeamSelection(
            player_id=data.player_id,
            team_code=data.team_code
        )

        result = select_team(room["id"], selection)

        return {
            "success": True,
            "message": "Berhasil bergabung menggunakan kode room",
            "room_code": room["room_code"],
            "room_name": room["match_name"],
            "join_result": result
        }

    except HTTPException:
        raise

    except Exception as error:
        print("JOIN BY CODE ERROR:", repr(error))

        raise HTTPException(
            status_code=500,
            detail=str(error)
        )


# ==========================================
# MATCH TIMER API
# ==========================================

@app.get("/api/matches/{match_id}/timer")
def get_match_timer(match_id: str):
    """Mengambil sisa waktu pertandingan dan mengakhiri match saat waktunya habis."""
    try:
        response = (
            supabase.table("matches")
            .select("id, status, started_at, ended_at, duration_hours")
            .eq("id", match_id)
            .limit(1)
            .execute()
        )
        if not response.data:
            raise HTTPException(status_code=404, detail="Pertandingan tidak ditemukan")

        match_data = response.data[0]
        now = datetime.now(timezone.utc)
        started_raw = match_data.get("started_at")
        duration_hours = match_data.get("duration_hours")

        if not started_raw or not duration_hours:
            return {
                "success": True,
                "status": match_data["status"],
                "started_at": started_raw,
                "ends_at": None,
                "remaining_seconds": None
            }

        started_at = datetime.fromisoformat(started_raw.replace("Z", "+00:00"))
        ends_at = started_at + timedelta(hours=float(duration_hours))
        remaining_seconds = max(0, int((ends_at - now).total_seconds()))

        if match_data["status"] == "active" and remaining_seconds <= 0:
            ended = (
                supabase.table("matches")
                .update({
                    "status": "completed",
                    "ended_at": now.isoformat()
                })
                .eq("id", match_id)
                .eq("status", "active")
                .execute()
            )
            if ended.data:
                match_data["status"] = "completed"
                match_data["ended_at"] = ended.data[0].get("ended_at")
            else:
                latest = (
                    supabase.table("matches")
                    .select("status, ended_at")
                    .eq("id", match_id)
                    .limit(1)
                    .execute()
                )
                if latest.data:
                    match_data["status"] = latest.data[0]["status"]
                    match_data["ended_at"] = latest.data[0].get("ended_at")

        return {
            "success": True,
            "status": match_data["status"],
            "started_at": started_at.isoformat(),
            "ends_at": ends_at.isoformat(),
            "remaining_seconds": remaining_seconds,
            "ended_at": match_data.get("ended_at")
        }

    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=500, detail=str(error))
