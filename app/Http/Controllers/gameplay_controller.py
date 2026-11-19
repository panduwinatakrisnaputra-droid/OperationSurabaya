import asyncio
from datetime import datetime, timezone, timedelta
from fastapi import HTTPException
from config.database import supabase
from app.Models.match import (
    HealthUpdate,
    PlayerHealRequest,
    PlayerShootRequest,
    BaseShutdownRequest,
    GhostModeScanRequest,
    WeaponLevelUpdate,
    WeaponUpgradeScanRequest,
)

WEAPON_DAMAGE_BY_LEVEL = {1: 10, 2: 15, 3: 20, 4: 25}

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
            .select("id, player_number, username, full_name")
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
                "player_number": player.get("player_number"),
                "username": player["username"],
                "full_name": player["full_name"],
                "team": team["team_name"],
                "team_code": team["team_code"],
                "current_health": member.get("current_health"),
                "max_health": member.get("max_health"),
                "is_healing": member.get("is_healing"),
                "is_eliminated": member.get("is_eliminated"),
                "weapon_level": member.get("weapon_level", 1),
                "ghost_mode_until": member.get("ghost_mode_until"),
                "player_status": member.get("player_status")
            })

        return {
            "success": True,
            "match_id": match_id,
            "total_players": len(result),
            "players": result
        }

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=str(error)
        )


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

        # Ghost Mode memberikan kekebalan penuh terhadap damage
        ghost_until = member.get("ghost_mode_until")
        if ghost_until:
            try:
                ghost_expiry = datetime.fromisoformat(str(ghost_until).replace("Z", "+00:00"))
                now = datetime.now(timezone.utc)
                if ghost_expiry > now:
                    remaining = max(1, int((ghost_expiry - now).total_seconds()))
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
                pass

        # 3. Hitung HP baru
        current_hp = member.get("current_health") or 0
        max_hp = member.get("max_health") or 100

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
            "amount": data.amount,
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


async def heal_player(match_id: str, data: PlayerHealRequest):
    """
    Memulihkan HP.
    Mendukung validasi QR Base Healing (OPS-HEALING:<station_code>) + Pose Verification,
    atau mode standar 5 detik timer.
    """
    try:
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
            raise HTTPException(status_code=400, detail="Healing hanya tersedia saat pertandingan aktif")

        member_response = (
            supabase.table("match_players")
            .select("player_id, team_id, player_status, current_health, max_health, is_eliminated, is_healing")
            .eq("match_id", match_id)
            .eq("player_id", data.player_id)
            .limit(1)
            .execute()
        )
        if not member_response.data:
            raise HTTPException(status_code=403, detail="Pemain tidak tergabung dalam pertandingan")
        member = member_response.data[0]

        team_response = (
            supabase.table("teams")
            .select("team_code")
            .eq("id", member.get("team_id"))
            .limit(1)
            .execute()
        )
        if not team_response.data:
            raise HTTPException(status_code=400, detail="Tim pemain tidak dapat diverifikasi")
        player_team = str(team_response.data[0].get("team_code", "")).upper()

        current_hp = member.get("current_health") if member.get("current_health") is not None else 100
        max_hp = member.get("max_health") or 100
        if member.get("is_eliminated") or member.get("player_status") == "eliminated" or current_hp <= 0:
            raise HTTPException(status_code=400, detail="Pemain tereliminasi dan tidak bisa healing")
        if current_hp >= max_hp:
            raise HTTPException(status_code=400, detail="Health pemain sudah maksimal")
        if member.get("is_healing"):
            raise HTTPException(status_code=409, detail="Pemain sedang melakukan healing")

        # JIKA MEMAKAI QR HEALING
        if data.qr_payload:
            prefix = "OPS-HEALING:"
            payload = data.qr_payload.strip()
            if not payload.startswith(prefix):
                raise HTTPException(status_code=400, detail="QR Code bukan QR Healing Base")
            station_code = payload[len(prefix):].strip()
            if not station_code:
                raise HTTPException(status_code=400, detail="Kode Healing Station tidak valid")

            station_response = (
                supabase.table("healing_stations")
                .select("station_code, station_name, team_code, heal_amount, is_active")
                .eq("station_code", station_code)
                .limit(1)
                .execute()
            )
            if not station_response.data or not station_response.data[0].get("is_active"):
                raise HTTPException(status_code=404, detail="Healing Station tidak ditemukan atau nonaktif")
            station = station_response.data[0]

            if player_team != str(station.get("team_code", "")).upper():
                raise HTTPException(status_code=403, detail="Healing hanya dapat dilakukan di base tim sendiri")

            if not data.pose_verified:
                raise HTTPException(status_code=400, detail="Pose healing belum berhasil divalidasi")

            amount = max(1, min(int(station.get("heal_amount") or 20), 100))
            new_hp = min(max_hp, current_hp + amount)

            update_response = (
                supabase.table("match_players")
                .update({"current_health": new_hp, "is_healing": False})
                .eq("match_id", match_id)
                .eq("player_id", data.player_id)
                .eq("is_eliminated", False)
                .execute()
            )
            if not update_response.data:
                raise HTTPException(status_code=409, detail="Gagal menyelesaikan healing")

            healed_amount = new_hp - current_hp
            try:
                supabase.table("game_events").insert({
                    "match_id": match_id,
                    "actor_player_id": data.player_id,
                    "event_type": "player_heal",
                    "description": f"Pemain memulihkan {healed_amount} HP di base {player_team}",
                    "event_data": {
                        "station_code": station_code,
                        "team_code": player_team,
                        "healed_amount": healed_amount,
                        "current_health": new_hp,
                        "max_health": max_hp,
                        "pose_verified": True
                    }
                }).execute()
            except Exception as event_error:
                print("HEAL EVENT ERROR:", repr(event_error))

            return {
                "success": True,
                "message": f"Healing berhasil! +{healed_amount} HP",
                "station_code": station_code,
                "healed_amount": healed_amount,
                "current_health": new_hp,
                "max_health": max_hp,
                "is_healing": False
            }

        # JIKA TANPA QR (STANDARD 5 SEC TIMER)
        healing_started = False
        try:
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

            await asyncio.sleep(5)

            latest_member = (
                supabase.table("match_players")
                .select("current_health, max_health, is_eliminated")
                .eq("match_id", match_id)
                .eq("player_id", data.player_id)
                .limit(1)
                .execute()
            )
            if not latest_member.data:
                raise HTTPException(status_code=404, detail="Data pemain tidak ditemukan")
            latest = latest_member.data[0]
            latest_hp = latest.get("current_health") if latest.get("current_health") is not None else 100
            latest_max = latest.get("max_health") or 100

            new_hp = min(latest_max, latest_hp + 20)
            update_response = (
                supabase.table("match_players")
                .update({"current_health": new_hp, "is_healing": False})
                .eq("match_id", match_id)
                .eq("player_id", data.player_id)
                .eq("is_eliminated", False)
                .execute()
            )
            healing_started = False
            healed_amount = new_hp - latest_hp

            try:
                supabase.table("game_events").insert({
                    "match_id": match_id,
                    "actor_player_id": data.player_id,
                    "event_type": "player_heal",
                    "description": f"Pemain berhasil memulihkan {healed_amount} HP",
                    "event_data": {"healed_amount": healed_amount, "current_health": new_hp}
                }).execute()
            except Exception:
                pass

            return {
                "success": True,
                "message": "Healing berhasil diselesaikan",
                "healing_duration_seconds": 5,
                "healed_amount": healed_amount,
                "current_health": new_hp,
                "max_health": latest_max,
                "is_healing": False
            }
        finally:
            if healing_started:
                try:
                    supabase.table("match_players").update({"is_healing": False})\
                        .eq("match_id", match_id).eq("player_id", data.player_id).execute()
                except Exception:
                    pass

    except HTTPException:
        raise
    except Exception as error:
        print("HEALING ERROR:", repr(error))
        raise HTTPException(status_code=500, detail="Terjadi kesalahan saat memproses healing")


def shoot_player(match_id: str, data: PlayerShootRequest):
    try:
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

        weapon_level = int(member.get("weapon_level") or 1)
        weapon_damage = WEAPON_DAMAGE_BY_LEVEL.get(weapon_level, 10)

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
                    "weapon_damage": weapon_damage
                }
            })
            .execute()
        )

        return {
            "success": True,
            "message": "Aktivitas tembakan berhasil dicatat",
            "weapon_level": weapon_level,
            "weapon_damage": weapon_damage,
            "event": event_response.data[0] if event_response.data else None
        }

    except HTTPException:
        raise
    except Exception as error:
        print("SHOOT ERROR:", repr(error))
        raise HTTPException(status_code=500, detail="Gagal mencatat aktivitas tembakan")


# ==========================================
# BASE SHUTDOWN CONTROLLERS
# ==========================================

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
        return {
            "success": True,
            "message": f"Proses shutdown Base {defender} dimulai",
            "attacker_team_code": attacker,
            "defender_team_code": defender,
            "event": event.data[0] if event.data else None
        }
    except HTTPException:
        raise
    except Exception as error:
        print("BASE SHUTDOWN START ERROR:", repr(error))
        raise HTTPException(status_code=500, detail="Gagal memulai proses Base Shutdown")


def complete_base_shutdown(match_id: str, data: BaseShutdownRequest):
    """Finalisasi shutdown base setelah countdown di Player Portal selesai."""
    try:
        match_res = supabase.table("matches").select("id,status,winner_team_code").eq("id", match_id).limit(1).execute()
        if not match_res.data:
            raise HTTPException(status_code=404, detail="Pertandingan tidak ditemukan")
        if match_res.data[0].get("status") != "active":
            raise HTTPException(status_code=400, detail="Pertandingan tidak aktif atau sudah berakhir")

        prefix = "OPS-BASE-SHUTDOWN:"
        payload = data.qr_payload.strip()
        if not payload.startswith(prefix):
            raise HTTPException(status_code=400, detail="QR bukan QR Base Shutdown")
        station_code = payload[len(prefix):].strip()
        station_res = supabase.table("base_shutdown_stations").select("station_code,team_code,is_active").eq("station_code", station_code).limit(1).execute()
        if not station_res.data or not station_res.data[0].get("is_active"):
            raise HTTPException(status_code=404, detail="QR Base Shutdown tidak ditemukan atau nonaktif")
        station = station_res.data[0]

        member_res = supabase.table("match_players").select("player_id,team_id,player_status,is_eliminated,current_health").eq("match_id", match_id).eq("player_id", data.player_id).limit(1).execute()
        if not member_res.data:
            raise HTTPException(status_code=403, detail="Pemain tidak tergabung dalam pertandingan")
        member = member_res.data[0]
        team_res = supabase.table("teams").select("team_code").eq("id", member.get("team_id")).limit(1).execute()
        if not team_res.data:
            raise HTTPException(status_code=400, detail="Tim pemain tidak dapat diverifikasi")

        attacker = str(team_res.data[0].get("team_code", "")).upper()
        defender = str(station.get("team_code", "")).upper()
        if attacker == defender:
            raise HTTPException(status_code=403, detail="Kamu tidak dapat menonaktifkan base tim sendiri")
        if attacker not in ("RED", "BLUE") or defender not in ("RED", "BLUE"):
            raise HTTPException(status_code=400, detail="Identitas tim tidak valid")
        if member.get("is_eliminated") or member.get("player_status") == "eliminated" or (member.get("current_health") or 0) <= 0:
            raise HTTPException(status_code=400, detail="Pemain tereliminasi tidak dapat melakukan shutdown")

        try:
            supabase.table("base_shutdowns").insert({
                "match_id": match_id,
                "station_code": station_code,
                "attacker_team_code": attacker,
                "defender_team_code": defender,
                "player_id": data.player_id,
                "status": "completed"
            }).execute()
        except Exception:
            raise HTTPException(status_code=409, detail="Base sudah dinonaktifkan atau proses shutdown sudah diselesaikan")

        update = supabase.table("matches").update({
            "status": "completed",
            "ended_at": datetime.now(timezone.utc).isoformat(),
            "winner_team_code": attacker
        }).eq("id", match_id).eq("status", "active").execute()

        if not update.data:
            raise HTTPException(status_code=409, detail="Pertandingan sudah diselesaikan oleh proses lain")

        supabase.table("game_events").insert({
            "match_id": match_id,
            "actor_player_id": data.player_id,
            "event_type": "base_shutdown_success",
            "description": f"Tim {attacker} berhasil menonaktifkan base {defender} dan memenangkan pertandingan",
            "event_data": {"station_code": station_code, "attacker_team_code": attacker, "defender_team_code": defender}
        }).execute()

        return {
            "success": True,
            "message": f"BASE {defender} BERHASIL DINONAKTIFKAN. TIM {attacker} MENANG!",
            "winner_team_code": attacker,
            "defeated_team_code": defender,
            "match_status": "completed"
        }
    except HTTPException:
        raise
    except Exception as error:
        print("BASE SHUTDOWN ERROR:", repr(error))
        raise HTTPException(status_code=500, detail="Terjadi kesalahan saat memproses Base Shutdown")


# ==========================================
# GHOST MODE CONTROLLERS
# ==========================================

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
# WEAPON UPGRADE CONTROLLERS
# ==========================================

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


def admin_update_weapon_level(match_id: str, data: WeaponLevelUpdate):
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
        return {
            "success": True,
            "message": "Level senjata berhasil diperbarui",
            "player_id": data.player_id,
            "weapon_level": data.weapon_level,
            "damage": damage
        }
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=500, detail=str(error))


# ==========================================
# MATCH TIMER CONTROLLER
# ==========================================

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


# ==========================================
# MATCH EVENT LOG CONTROLLERS
# ==========================================

def get_match_events(match_id: str, limit: int = 50):
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

        events_response = (
            supabase.table("game_events")
            .select("*")
            .eq("match_id", match_id)
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )

        events = events_response.data or []

        return {
            "success": True,
            "match_id": match_id,
            "total_events": len(events),
            "events": events
        }

    except HTTPException:
        raise

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=str(error)
        )


def clear_match_events(match_id: str):
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
            .execute()
        )

        return {
            "success": True,
            "message": "Seluruh event berhasil dihapus",
            "deleted_count": len(delete_response.data or [])
        }

    except HTTPException:
        raise

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=str(error)
        )


def get_match_analytics(match_id: str):
    try:
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
                "match_id": match_id,
                "total_players": 0,
                "players": []
            }

        player_ids = list(set(item["player_id"] for item in members))
        team_ids = list(set(item["team_id"] for item in members))

        players_response = (
            supabase.table("players")
            .select("id, player_number, username, full_name")
            .in_("id", player_ids)
            .execute()
        )

        player_map = {
            p["id"]: p for p in (players_response.data or [])
        }

        teams_response = (
            supabase.table("teams")
            .select("id, team_code, team_name")
            .in_("id", team_ids)
            .execute()
        )

        team_map = {
            t["id"]: t for t in (teams_response.data or [])
        }

        events_response = (
            supabase.table("game_events")
            .select("*")
            .eq("match_id", match_id)
            .order("created_at", desc=False)
            .execute()
        )

        events = events_response.data or []

        analytics = {}

        for member in members:
            player = player_map.get(member["player_id"])
            team = team_map.get(member["team_id"])

            if not player or not team:
                continue

            analytics[player["id"]] = {
                "player_id": player["id"],
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

        movement_recorded = set()

        for event in events:
            actor_id = event.get("actor_player_id")
            target_id = event.get("target_player_id")
            event_type = event.get("event_type")
            event_data = event.get("event_data") or {}

            if event_type == "player_shot":
                if actor_id in analytics:
                    analytics[actor_id]["total_shots"] += 1

            elif event_type == "player_hit":
                if actor_id in analytics:
                    analytics[actor_id]["total_hit_given"] += 1

                if target_id in analytics:
                    analytics[target_id]["total_hit_received"] += 1

            elif event_type == "player_heal":
                if actor_id in analytics:
                    analytics[actor_id]["total_heal"] += 1

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
