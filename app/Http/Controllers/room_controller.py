import secrets
from fastapi import HTTPException
from config.database import supabase
from app.Models.match import CreateRoomRequest, JoinRoomByCodeRequest, TeamSelection
from app.Http.Controllers.match_controller import select_team

TEAM_CATALOG = [
    {"team_code":"RED", "team_name":"RED", "team_color":"#EF4444"},
    {"team_code":"BLUE", "team_name":"BLUE", "team_color":"#3B82F6"},
    {"team_code":"GREEN", "team_name":"GREEN", "team_color":"#22C55E"},
    {"team_code":"YELLOW", "team_name":"YELLOW", "team_color":"#EAB308"},
]

def _teams_for_match(match_id):
    config = supabase.table("match_teams").select("team_id,capacity,team_order,teams(id,team_code,team_name,team_color)").eq("match_id", match_id).order("team_order").execute().data or []
    counts = supabase.table("match_players").select("team_id").eq("match_id", match_id).execute().data or []
    count_map = {}
    for row in counts:
        count_map[row["team_id"]] = count_map.get(row["team_id"], 0) + 1
    result = []
    for row in config:
        team = row.get("teams") or {}
        total = count_map.get(row["team_id"], 0)
        result.append({**team, "capacity": row["capacity"], "total": total, "available": max(0, row["capacity"]-total)})
    return result

def get_rooms(status="all", search="", page=1, page_size=20):
    try:
        if status not in ["all", "waiting", "active", "completed", "cancelled"]:
            raise HTTPException(400, "Status room tidak valid")
        if page < 1 or page_size < 1 or page_size > 100:
            raise HTTPException(400, "Parameter halaman tidak valid")
        query = supabase.table("matches").select("*", count="exact").order("created_at", desc=True)
        if status != "all": query = query.eq("status", status)
        if search.strip():
            keyword = search.strip().replace(",", "")
            query = query.or_(f"match_name.ilike.%{keyword}%,room_code.ilike.%{keyword}%")
        response = query.range((page-1)*page_size, page*page_size-1).execute()
        matches = response.data or []
        data = []
        for match in matches:
            teams = _teams_for_match(match["id"])
            data.append({"id":match["id"], "match_name":match["match_name"], "room_code":match.get("room_code"), "status":match["status"], "arena_name":match.get("arena_name"), "teams":teams, "total_players":sum(t["total"] for t in teams), "max_players":sum(t["capacity"] for t in teams), "created_at":match.get("created_at")})
        total = response.count or 0
        return {"success":True, "total_rooms":total, "page":page, "page_size":page_size, "total_pages":(total+page_size-1)//page_size, "data":data}
    except HTTPException: raise
    except Exception as error:
        print("ROOM BROWSER ERROR:", repr(error))
        raise HTTPException(500, "Gagal mengambil daftar room")

def create_room(data: CreateRoomRequest):
    created_match_id = None
    try:
        codes = [item.team_code for item in data.teams]
        if len(codes) < 2 or len(codes) != len(set(codes)):
            raise HTTPException(400, "Minimal dua tim dan setiap tim harus unik")
        if codes != [item["team_code"] for item in TEAM_CATALOG[:len(codes)]]:
            raise HTTPException(400, "Urutan tim harus mengikuti urutan warna sistem")
        if data.team_code not in codes:
            raise HTTPException(400, "Tim Host harus termasuk dalam konfigurasi room")
        host_res = supabase.table("players").select("id,player_number,username,full_name,email").eq("id", data.host_player_id).limit(1).execute()
        if not host_res.data: raise HTTPException(404, "Data Host tidak ditemukan")
        host = host_res.data[0]
        team_res = supabase.table("teams").select("id,team_code,team_name,team_color").in_("team_code", codes).execute()
        team_map = {t["team_code"]:t for t in (team_res.data or [])}
        if any(code not in team_map for code in codes): raise HTTPException(500, "Master data warna tim belum lengkap. Jalankan migration Dynamic Team System.")
        room_code = None
        for _ in range(10):
            candidate = secrets.token_hex(4).upper()
            if not supabase.table("matches").select("id").eq("room_code", candidate).limit(1).execute().data:
                room_code = candidate; break
        if not room_code: raise HTTPException(500, "Gagal membuat kode room unik")
        capacities = {item.team_code:item.capacity for item in data.teams}
        max_players = sum(capacities.values())
        match_res = supabase.table("matches").insert({"match_name":data.match_name,"room_code":room_code,"status":"waiting","red_capacity":capacities["RED"],"blue_capacity":capacities["BLUE"],"max_players":max_players,"duration_hours":24,"arena_name":data.arena_name}).execute()
        if not match_res.data: raise Exception("Gagal membuat room")
        match = match_res.data[0]; created_match_id = match["id"]
        rows = [{"match_id":created_match_id,"team_id":team_map[item.team_code]["id"],"capacity":item.capacity,"team_order":index+1} for index,item in enumerate(data.teams)]
        supabase.table("match_teams").insert(rows).execute()
        host_team = team_map[data.team_code]
        supabase.table("match_players").insert({"match_id":created_match_id,"player_id":host["id"],"team_id":host_team["id"],"player_status":"joined","is_host":True}).execute()
        teams = [{**team_map[item.team_code],"capacity":item.capacity,"total":1 if item.team_code == data.team_code else 0,"available":item.capacity-(1 if item.team_code == data.team_code else 0)} for item in data.teams]
        return {"success":True,"message":"Room berhasil dibuat","room":{"id":match["id"],"match_name":match["match_name"],"room_code":match["room_code"],"status":match["status"],"arena_name":match["arena_name"],"max_players":max_players,"teams":teams},"host":{"player":host,"team":host_team,"is_host":True}}
    except HTTPException: raise
    except Exception as error:
        if created_match_id:
            try: supabase.table("matches").delete().eq("id", created_match_id).execute()
            except Exception as cleanup_error: print("ROOM CLEANUP ERROR:", repr(cleanup_error))
        print("CREATE ROOM ERROR:", repr(error))
        raise HTTPException(500, detail=str(error))

def join_room_by_code(data: JoinRoomByCodeRequest):
    try:
        room_res = supabase.table("matches").select("*").eq("room_code", data.room_code.strip().upper()).limit(1).execute()
        if not room_res.data: raise HTTPException(404, "Kode room tidak ditemukan")
        room = room_res.data[0]
        if room["status"] != "waiting": raise HTTPException(400, "Room sudah tidak menerima pemain")
        result = select_team(room["id"], TeamSelection(player_id=data.player_id, team_code=data.team_code))
        return {"success":True,"message":"Berhasil bergabung ke room","room_code":room["room_code"],"room_name":room["match_name"],"join_result":result}
    except HTTPException: raise
    except Exception as error:
        print("JOIN BY CODE ERROR:", repr(error)); raise HTTPException(500, detail=str(error))
