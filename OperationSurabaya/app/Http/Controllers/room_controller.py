import secrets
from typing import Optional
from fastapi import HTTPException
from config.database import supabase
from app.Models.match import CreateRoomRequest, JoinRoomByCodeRequest, TeamSelection
from app.Http.Controllers.match_controller import select_team

def get_rooms(
    status: str = "all",
    search: str = "",
    page: int = 1,
    page_size: int = 20
):
    try:
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

        match_ids = [m["id"] for m in matches]

        members_response = (
            supabase.table("match_players")
            .select("match_id, team_id")
            .in_("match_id", match_ids)
            .execute()
        )

        members = members_response.data or []

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

        room_counts = {
            match["id"]: {"red": 0, "blue": 0}
            for match in matches
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
                    "available": max(0, red_capacity - red_count)
                },
                "blue_team": {
                    "total": blue_count,
                    "capacity": blue_capacity,
                    "available": max(0, blue_capacity - blue_count)
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
            "total_pages": (total_rooms + page_size - 1) // page_size,
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


def create_room(data: CreateRoomRequest):
    created_match_id = None
    try:
        player_response = (
            supabase.table("players")
            .select("id, player_number, username, full_name, email")
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

        max_players = data.red_capacity + data.blue_capacity

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
        if created_match_id:
            try:
                supabase.table("matches").delete().eq("id", created_match_id).execute()
            except Exception as cleanup_error:
                print("ROOM CLEANUP ERROR:", repr(cleanup_error))

        print("CREATE ROOM ERROR:", repr(error))
        raise HTTPException(
            status_code=500,
            detail=str(error)
        )


def join_room_by_code(data: JoinRoomByCodeRequest):
    try:
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

        if room["status"] != "waiting":
            raise HTTPException(
                status_code=400,
                detail="Room sudah tidak menerima pemain"
            )

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
