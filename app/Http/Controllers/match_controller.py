from datetime import datetime, timezone
from fastapi import HTTPException
from config.database import supabase
from app.Models.match import TeamSelection, LeaveTeamRequest

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

