import asyncio
from datetime import datetime, timezone
from fastapi import HTTPException
from config.database import supabase
from app.Models.match import HealthUpdate, PlayerHealRequest, PlayerShootRequest

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