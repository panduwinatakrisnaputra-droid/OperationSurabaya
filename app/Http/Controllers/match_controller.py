from datetime import datetime, timezone
from fastapi import HTTPException
from config.database import supabase
from app.Models.match import TeamSelection, LeaveTeamRequest


def get_match_history():
    """Mengambil riwayat pertandingan dari database yang sudah ada."""
    try:
        # Ambil seluruh pertandingan
        matches_response = (
            supabase.table("matches")
            .select("*")
            .order("created_at", desc=True)
            .execute()
        )
        matches = matches_response.data or []

        if not matches:
            return {
                "success": True,
                "history": []
            }

        # Ambil seluruh data pemain pertandingan
        members_response = (
            supabase.table("match_players")
            .select("*")
            .execute()
        )
        members = members_response.data or []

        # Ambil data tim
        teams_response = (
            supabase.table("teams")
            .select("id, team_code")
            .execute()
        )
        teams = teams_response.data or []

        team_map = {
            team["id"]: team.get("team_code")
            for team in teams
        }

        # Ambil event pertandingan
        events_response = (
            supabase.table("game_events")
            .select("*")
            .execute()
        )
        events = events_response.data or []

        history = []

        for match in matches:
            match_id = match["id"]

            match_members = [
                member for member in members
                if member.get("match_id") == match_id
            ]

            match_events = [
                event for event in events
                if event.get("match_id") == match_id
            ]

            red_players = 0
            blue_players = 0

            for member in match_members:
                team_code = team_map.get(member.get("team_id"))

                if team_code == "RED":
                    red_players += 1
                elif team_code == "BLUE":
                    blue_players += 1

            # Hitung event tembakan berdasarkan jenis event.
            total_shots = sum(
                1 for event in match_events
                if any(
                    keyword in str(event.get("event_type", "")).lower()
                    for keyword in ("shoot", "shot", "firing")
                )
            )

            # Hitung durasi pertandingan
            duration_seconds = None
            started_at = match.get("started_at")
            ended_at = match.get("ended_at")

            if started_at:
                try:
                    start = datetime.fromisoformat(
                        started_at.replace("Z", "+00:00")
                    )

                    end = (
                        datetime.fromisoformat(
                            ended_at.replace("Z", "+00:00")
                        )
                        if ended_at
                        else (
                            datetime.now(timezone.utc)
                            if match.get("status") == "active"
                            else None
                        )
                    )

                    if end:
                        duration_seconds = max(
                            0, int((end - start).total_seconds())
                        )

                except (ValueError, TypeError):
                    duration_seconds = None

            configured = supabase.table("match_teams").select("team_id,capacity,teams(team_code,team_name,team_color)").eq("match_id", match_id).execute().data or []
            team_stats = []
            for config in configured:
                team_info = config.get("teams") or {}
                team_count = sum(1 for member in match_members if team_map.get(member.get("team_id")) == team_info.get("team_code"))
                team_stats.append({**team_info, "total_players": team_count, "capacity": config.get("capacity")})

            history.append({
                **match,
                "team_stats": team_stats,
                "match_name": (
                    match.get("match_name")
                    or match.get("name")
                    or "Untitled Match"
                ),
                "duration_seconds": duration_seconds,
                "total_players": len(match_members),
                "red_players": red_players,
                "blue_players": blue_players,
                "total_shots": total_shots,
                "total_events": len(match_events)
            })

        return {
            "success": True,
            "history": history
        }

    except Exception as error:
        print("GET MATCH HISTORY ERROR:", repr(error))
        raise HTTPException(
            status_code=500,
            detail="Gagal mengambil riwayat pertandingan: " + str(error)
        )



def select_team(match_id: str, selection: TeamSelection):
    """Join atau pindahkan pemain ke tim yang dikonfigurasi khusus untuk room ini."""
    try:
        match_res = supabase.table("matches").select("id,status").eq("id", match_id).limit(1).execute()
        if not match_res.data: raise HTTPException(404, "Pertandingan tidak ditemukan")
        if match_res.data[0]["status"] != "waiting": raise HTTPException(400, "Pertandingan sudah tidak menerima pemain")
        player_res = supabase.table("players").select("id,player_number,username,full_name,status").eq("id", selection.player_id).limit(1).execute()
        if not player_res.data: raise HTTPException(404, "Pemain tidak ditemukan")
        team_res = supabase.table("teams").select("id,team_code,team_name,team_color").eq("team_code", selection.team_code).limit(1).execute()
        if not team_res.data: raise HTTPException(404, "Tim tidak ditemukan")
        team = team_res.data[0]
        config_res = supabase.table("match_teams").select("capacity").eq("match_id", match_id).eq("team_id", team["id"]).limit(1).execute()
        if not config_res.data: raise HTTPException(400, "Tim ini tidak tersedia pada room tersebut")
        capacity = int(config_res.data[0]["capacity"])
        existing_res = supabase.table("match_players").select("id,team_id").eq("match_id", match_id).eq("player_id", selection.player_id).limit(1).execute()
        existing = existing_res.data[0] if existing_res.data else None
        try:
            supabase.rpc("join_match_team", {"p_match_id":match_id,"p_player_id":selection.player_id,"p_team_code":selection.team_code}).execute()
        except Exception as join_error:
            message = str(join_error)
            if "penuh" in message.lower(): raise HTTPException(400, f"Tim {team['team_name']} sudah penuh")
            if "tidak tersedia" in message.lower(): raise HTTPException(400, "Tim ini tidak tersedia pada room tersebut")
            if "tidak menerima pemain" in message.lower(): raise HTTPException(400, "Pertandingan sudah tidak menerima pemain")
            if "tidak ditemukan" in message.lower(): raise HTTPException(404, "Pertandingan tidak ditemukan")
            raise
        result = supabase.table("match_players").select("*").eq("match_id",match_id).eq("player_id",selection.player_id).limit(1).execute()
        return {"success":True,"message":f"Berhasil bergabung ke {team['team_name']}","match_id":match_id,"player":player_res.data[0],"team":team,"data":result.data}
    except HTTPException: raise
    except Exception as error: raise HTTPException(status_code=500, detail=str(error))

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
    """Menghasilkan semua tim dan anggotanya berdasarkan konfigurasi room."""
    try:
        match_res = supabase.table("matches").select("*").eq("id", match_id).limit(1).execute()
        if not match_res.data: raise HTTPException(404, "Pertandingan tidak ditemukan")
        match = match_res.data[0]
        members = supabase.table("match_players").select("*").eq("match_id", match_id).execute().data or []
        team_config = supabase.table("match_teams").select("team_id,capacity,team_order,teams(id,team_code,team_name,team_color)").eq("match_id", match_id).order("team_order").execute().data or []
        player_ids = list({m["player_id"] for m in members})
        players = supabase.table("players").select("id,player_number,username,full_name,status").in_("id", player_ids).execute().data or [] if player_ids else []
        player_map = {p["id"]:p for p in players}
        grouped = {row["team_id"]:[] for row in team_config}
        for member in members:
            team_id = member.get("team_id")
            player = player_map.get(member.get("player_id"))
            if team_id in grouped and player:
                grouped[team_id].append({"player":player,"player_status":member.get("player_status"),"joined_at":member.get("joined_at")})
        teams = []
        for row in team_config:
            team = row.get("teams") or {}
            entries = grouped.get(row["team_id"], [])
            teams.append({**team,"capacity":row["capacity"],"total":len(entries),"players":entries})
        return {"success":True,"match":match,"lobby":{"total_players":len(members),"max_players":sum(t["capacity"] for t in teams),"teams":teams}}
    except HTTPException: raise
    except Exception as error: raise HTTPException(status_code=500, detail=str(error))

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

