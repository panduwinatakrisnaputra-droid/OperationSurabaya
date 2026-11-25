import os
import re
import uuid
import socketio
from fastapi import APIRouter
from fastapi.responses import HTMLResponse, JSONResponse
from config.config import LIVEKIT_URL
from app.Http.Controllers import comms_controller as ctrl

# Instance Async Socket.IO untuk FastAPI
sio = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins="*")
router = APIRouter(prefix="/comms", tags=["Tactical Comms"])

VIEWS_COMMS_DIR = os.path.join("resources", "views", "comms")
DYNAMIC_ROOM_RE = re.compile(r"^[A-Z0-9_-]{3,24}$")


def normalize_team_key(raw_team: str) -> str:
    val = str(raw_team or "").strip().lower()
    if val in {"red", "merah", "tim merah", "red team"}:
        return "merah"
    if val in {"blue", "biru", "tim biru", "blue team"}:
        return "biru"
    cleaned = re.sub(r"[^a-z0-9_-]+", "_", val).strip("_")
    return cleaned[:24] or "merah"


def format_team_label(team_key: str, room: dict = None) -> str:
    if room and isinstance(room.get("team_meta"), dict):
        meta = room["team_meta"].get(team_key)
        if meta and meta.get("label"):
            return meta["label"]
    if team_key == "merah":
        return "TIM MERAH"
    if team_key == "biru":
        return "TIM BIRU"
    return team_key.replace("_", " ").upper()


def get_room_teams(room: dict) -> list:
    if room and room.get("teams"):
        return list(room["teams"])
    return ["merah", "biru"]


def build_team_stats(room: dict) -> dict:
    teams = get_room_teams(room)
    team_meta = room.get("team_meta") or {}
    stats = {}
    for t in teams:
        members = [p for p in room["players"].values() if p["team"] == t]
        online_count = sum(1 for p in members if p.get("online"))
        max_cap = int(team_meta.get(t, {}).get("max_players") or ctrl.MAX_PLAYERS_PER_TEAM)
        stats[t] = {
            "key": t,
            "label": format_team_label(t, room),
            "online": online_count,
            "joined": len(members),
            "max": max_cap,
        }
    return stats


def dynamic_room_summary(room: dict) -> dict:
    stats = build_team_stats(room)
    red_stat = stats.get("merah", {"online": 0, "joined": 0, "max": 10})
    blue_stat = stats.get("biru", {"online": 0, "joined": 0, "max": 10})
    return {
        "room_id": room["room_id"],
        "room_name": room.get("room_name") or room["room_id"],
        "host_name": room.get("host_name") or "Command Center",
        "created_at": room.get("created_at"),
        "teams": list(stats.values()),
        "red_online": red_stat["online"],
        "red_count": red_stat["joined"],
        "red_max": red_stat["max"],
        "blue_online": blue_stat["online"],
        "blue_count": blue_stat["joined"],
        "blue_max": blue_stat["max"],
    }


def list_dynamic_rooms() -> list:
    with ctrl.lock:
        return [dynamic_room_summary(r) for r in ctrl.rooms.values()]


# ==============================
# HALAMAN WEB TACTICAL COMMS
# ==============================

@router.get("/health")
def comms_health():
    with ctrl.lock:
        return JSONResponse({
            "status": "ok",
            "active_rooms": len(ctrl.rooms),
            "max_active_rooms": ctrl.MAX_ACTIVE_ROOMS,
        })


@router.get("/player", response_class=HTMLResponse)
def comms_player_page():
    file_path = os.path.join(VIEWS_COMMS_DIR, "player.html")
    with open(file_path, "r", encoding="utf-8") as f:
        return HTMLResponse(f.read())


@router.get("/host", response_class=HTMLResponse)
def comms_host_page():
    file_path = os.path.join(VIEWS_COMMS_DIR, "host.html")
    with open(file_path, "r", encoding="utf-8") as f:
        return HTMLResponse(f.read())


# ==============================
# FUNGSI HELPER SOCKET.IO
# ==============================

async def broadcast_room_list():
    data = {"rooms": list_dynamic_rooms()}
    await sio.emit("room_list_update", data, room="player_lobby")
    await sio.emit("host_room_list_update", data, room="host_lobby")


async def emit_roster(room_id: str):
    room = ctrl.rooms.get(room_id)
    if not room:
        return

    stats = build_team_stats(room)
    for team_key in get_room_teams(room):
        team_players = ctrl.roster_for(room, team_key)
        t_stat = stats.get(team_key, {})
        await sio.emit(
            "room_roster",
            {
                "room_id": room_id,
                "team": team_key,
                "team_label": format_team_label(team_key, room),
                "players": team_players,
                "count": len(team_players),
                "online_count": t_stat.get("online", len(team_players)),
                "max_players": t_stat.get("max", ctrl.MAX_PLAYERS_PER_TEAM),
                "team_stats": list(stats.values()),
            },
            room=ctrl.team_channel(room_id, team_key),
        )

    all_players = ctrl.roster_for(room)
    await sio.emit(
        "host_room_roster",
        {
            "room_id": room_id,
            "players": all_players,
            "teams": list(stats.values()),
            "red_count": sum(1 for p in all_players if p["team"] == "merah"),
            "blue_count": sum(1 for p in all_players if p["team"] == "biru"),
        },
        room=ctrl.host_channel(room_id),
    )
    await broadcast_room_list()


async def attach_player(sid: str, room_id: str, player: dict):
    player["sid"] = sid
    player["online"] = True
    ctrl.player_sid_to_identity[sid] = (room_id, player["player_id"])
    await sio.enter_room(sid, ctrl.room_channel(room_id))
    await sio.enter_room(sid, ctrl.team_channel(room_id, player["team"]))


async def attach_host(sid: str, room_id: str, host_token: str):
    room = ctrl.rooms.get(room_id)
    await sio.enter_room(sid, ctrl.room_channel(room_id))
    await sio.enter_room(sid, ctrl.host_channel(room_id))
    for team_key in get_room_teams(room):
        await sio.enter_room(sid, ctrl.team_channel(room_id, team_key))
    ctrl.host_sid_to_token[sid] = host_token


async def emit_joined(sid: str, room_id: str, player: dict):
    room = ctrl.rooms[room_id]
    team_key = player["team"]
    room["team_messages"].setdefault(team_key, [])
    stats = build_team_stats(room)
    t_stat = stats.get(team_key, {})

    await sio.emit(
        "player_joined",
        {
            "room_id": room_id,
            "room_name": room.get("room_name") or room_id,
            "player_id": player["player_id"],
            "player_token": player["player_token"],
            "name": player["name"],
            "team": team_key,
            "team_label": format_team_label(team_key, room),
            "max_players": t_stat.get("max", ctrl.MAX_PLAYERS_PER_TEAM),
            "team_stats": list(stats.values()),
            "messages": list(room["team_messages"][team_key]),
            "players": ctrl.roster_for(room, team_key),
        },
        to=sid,
    )
    await emit_roster(room_id)


def parse_teams_config(raw_teams) -> tuple:
    """Mengubah konfigurasi tim dari player-app / admin-dashboard menjadi daftar key & metadata kapasitas."""
    team_keys = []
    team_meta = {}
    if isinstance(raw_teams, list) and raw_teams:
        for item in raw_teams:
            if not isinstance(item, dict):
                continue
            raw_code = item.get("code") or item.get("team") or item.get("name") or ""
            key = normalize_team_key(raw_code)
            if not key:
                continue
            label = str(item.get("name") or item.get("label") or format_team_label(key)).strip().upper()
            try:
                max_p = max(1, min(50, int(item.get("max_players") or item.get("max") or ctrl.MAX_PLAYERS_PER_TEAM)))
            except (TypeError, ValueError):
                max_p = ctrl.MAX_PLAYERS_PER_TEAM
            if key not in team_meta:
                team_keys.append(key)
                team_meta[key] = {"key": key, "label": label, "max_players": max_p}

    if not team_keys:
        team_keys = ["merah", "biru"]
        team_meta = {
            "merah": {"key": "merah", "label": "RED TEAM", "max_players": ctrl.MAX_PLAYERS_PER_TEAM},
            "biru": {"key": "biru", "label": "BLUE TEAM", "max_players": ctrl.MAX_PLAYERS_PER_TEAM},
        }
    return team_keys, team_meta


# ==============================
# EVENT SOCKET.IO
# ==============================

@sio.event
async def connect(sid, environ):
    await sio.enter_room(sid, "player_lobby")
    await sio.emit("room_list_update", {"rooms": list_dynamic_rooms()}, to=sid)


@sio.on("host_register")
async def on_host_register(sid, data=None):
    data = data or {}
    token = ctrl.clean_token(data.get("host_token"))
    if not token:
        await sio.emit("host_error", {"message": "Identitas Host tidak valid. Muat ulang halaman."}, to=sid)
        return
    await sio.enter_room(sid, "host_lobby")
    ctrl.host_sid_to_token[sid] = token
    await sio.emit("host_registered", {"ok": True, "rooms": list_dynamic_rooms()}, to=sid)


@sio.on("host_create_room")
async def on_host_create_room(sid, data=None):
    data = data or {}
    token = ctrl.clean_token(data.get("host_token"))
    host_name = ctrl.clean_name(data.get("host_name")) or "Command Center"
    custom_code = str(data.get("room_id") or "").strip().upper()
    if not token:
        await sio.emit("host_error", {"message": "Identitas Host tidak valid."}, to=sid)
        return

    team_keys, team_meta = parse_teams_config(data.get("teams"))

    with ctrl.lock:
        if custom_code and custom_code in ctrl.rooms:
            room = ctrl.rooms[custom_code]
            room["host_token"] = token
            room["host_name"] = host_name
            if data.get("room_name"):
                room["room_name"] = str(data.get("room_name")).strip()[:60]
            if data.get("teams"):
                for tk in team_keys:
                    if tk not in room["teams"]:
                        room["teams"].append(tk)
                    room.setdefault("team_meta", {})[tk] = team_meta[tk]
                    room["team_messages"].setdefault(tk, [])
            room_id = custom_code
        else:
            if len(ctrl.rooms) >= ctrl.MAX_ACTIVE_ROOMS:
                await sio.emit("host_error", {"message": f"Maksimal {ctrl.MAX_ACTIVE_ROOMS} Room aktif."}, to=sid)
                return
            room_id = custom_code if DYNAMIC_ROOM_RE.fullmatch(custom_code) else None
            if not room_id:
                import secrets
                while True:
                    room_id = "TC-" + secrets.token_hex(3).upper()
                    if room_id not in ctrl.rooms:
                        break
            ctrl.rooms[room_id] = {
                "room_id": room_id,
                "room_name": str(data.get("room_name") or room_id).strip()[:60],
                "host_token": token,
                "host_name": host_name,
                "created_at": ctrl.now_iso(),
                "teams": team_keys,
                "team_meta": team_meta,
                "players": {},
                "team_messages": {t: [] for t in team_keys},
            }
        room = ctrl.rooms[room_id]
        summary = dynamic_room_summary(room)
        payload = {
            "room_id": room_id,
            "room_name": room.get("room_name") or room_id,
            "teams": list(build_team_stats(room).values()),
            "players": ctrl.roster_for(room),
            "messages_by_team": {t: list(room["team_messages"].get(t, [])) for t in get_room_teams(room)},
        }

    await attach_host(sid, room_id, token)
    await sio.emit("host_room_created", {"room": summary}, to=sid)
    await sio.emit("host_monitor_joined", payload, to=sid)
    await broadcast_room_list()


@sio.on("host_enter_room")
async def on_host_enter_room(sid, data=None):
    data = data or {}
    room_id = str(data.get("room_id") or "").strip().upper()
    token = ctrl.clean_token(data.get("host_token"))
    with ctrl.lock:
        room = ctrl.rooms.get(room_id)
        if not room or not token:
            await sio.emit("host_error", {"message": "Room tidak ditemukan."}, to=sid)
            return
        # Admin Dashboard berhak memantau & broadcast ke room operasi aktif mana pun
        room["host_token"] = token
        payload = {
            "room_id": room_id,
            "room_name": room.get("room_name") or room_id,
            "teams": list(build_team_stats(room).values()),
            "players": ctrl.roster_for(room),
            "messages_by_team": {t: list(room["team_messages"].get(t, [])) for t in get_room_teams(room)},
            "red_messages": list(room["team_messages"].get("merah", [])),
            "blue_messages": list(room["team_messages"].get("biru", [])),
        }
    await attach_host(sid, room_id, token)
    await sio.emit("host_monitor_joined", payload, to=sid)


@sio.on("player_list_rooms")
async def on_player_list_rooms(sid, data=None):
    await sio.emit("room_list_update", {"rooms": list_dynamic_rooms()}, to=sid)


@sio.on("player_join_room")
async def on_player_join_room(sid, data=None):
    data = data or {}
    room_id = str(data.get("room_id") or "").strip().upper()
    room_name = str(data.get("room_name") or room_id).strip()[:60]
    name = ctrl.clean_name(data.get("name")) or "Player"
    team = normalize_team_key(data.get("team"))
    token = ctrl.clean_token(data.get("player_token"))
    auto_create = bool(data.get("auto_create", True))

    if not DYNAMIC_ROOM_RE.fullmatch(room_id):
        await sio.emit("player_error", {"message": "Kode Room tidak valid."}, to=sid)
        return
    if not token:
        await sio.emit("player_error", {"message": "Identitas pemain tidak valid. Muat ulang halaman."}, to=sid)
        return

    with ctrl.lock:
        # Jika pemain pindah tim / room di sesi yang sama, lepaskan keanggotaan lama terlebih dahulu
        old_identity = ctrl.player_sid_to_identity.pop(sid, None)
        if old_identity:
            old_rid, old_pid = old_identity
            old_room = ctrl.rooms.get(old_rid)
            if old_room:
                old_room["players"].pop(old_pid, None)

        for other_rid, other_room in list(ctrl.rooms.items()):
            for pid, existing in list(other_room["players"].items()):
                if existing["player_token"] == token and (other_rid != room_id or existing["team"] != team):
                    other_room["players"].pop(pid, None)

        room = ctrl.rooms.get(room_id)
        team_keys, team_meta = parse_teams_config(data.get("teams"))

        if not room:
            if not auto_create:
                await sio.emit("player_error", {"message": "Room tidak ditemukan."}, to=sid)
                return
            if team not in team_meta:
                team_keys.append(team)
                team_meta[team] = {
                    "key": team,
                    "label": format_team_label(team),
                    "max_players": ctrl.MAX_PLAYERS_PER_TEAM,
                }
            room = {
                "room_id": room_id,
                "room_name": room_name or room_id,
                "host_token": "auto-host-" + room_id,
                "host_name": "Command Center",
                "created_at": ctrl.now_iso(),
                "teams": team_keys,
                "team_meta": team_meta,
                "players": {},
                "team_messages": {t: [] for t in team_keys},
            }
            ctrl.rooms[room_id] = room
        else:
            # Perbarui metadata kapasitas & tim jika dikirim dari player-app
            if data.get("teams"):
                for tk in team_keys:
                    if tk not in room["teams"]:
                        room["teams"].append(tk)
                    room.setdefault("team_meta", {})[tk] = team_meta[tk]
                    room["team_messages"].setdefault(tk, [])
            if team not in room["teams"]:
                room["teams"].append(team)
                room.setdefault("team_meta", {})[team] = {
                    "key": team,
                    "label": format_team_label(team),
                    "max_players": ctrl.MAX_PLAYERS_PER_TEAM,
                }
                room["team_messages"].setdefault(team, [])

        # Cek jika token pemain sudah terdaftar di room & tim yang sama (reconnect)
        existing_same = None
        for p in room["players"].values():
            if p["player_token"] == token and p["team"] == team:
                existing_same = p
                break

        if existing_same:
            existing_same["name"] = name
            player = existing_same
        else:
            max_cap = int(room.get("team_meta", {}).get(team, {}).get("max_players") or ctrl.MAX_PLAYERS_PER_TEAM)
            count = sum(1 for p in room["players"].values() if p["team"] == team)
            if count >= max_cap:
                await sio.emit(
                    "player_error",
                    {"message": f"{format_team_label(team, room)} sudah penuh ({count}/{max_cap} anggota)."},
                    to=sid,
                )
                return
            player = ctrl.make_player(name, team, token)
            room["players"][player["player_id"]] = player

    await attach_player(sid, room_id, player)
    await emit_joined(sid, room_id, player)
    await sio.emit(
        "system_notice",
        {"message": f"{name} bergabung ke {format_team_label(team, room)}.", "kind": "join"},
        room=ctrl.team_channel(room_id, team),
        skip_sid=sid,
    )


@sio.on("player_resume")
async def on_player_resume(sid, data=None):
    data = data or {}
    token = ctrl.clean_token(data.get("player_token"))
    if not token:
        await sio.emit("resume_unavailable", {"message": "Token sesi tidak valid."}, to=sid)
        return
    with ctrl.lock:
        if sid in ctrl.player_sid_to_identity:
            return
        found = None
        for rid, room in ctrl.rooms.items():
            for player in room["players"].values():
                if player["player_token"] == token:
                    found = (rid, room, player)
                    break
            if found:
                break
        if not found:
            await sio.emit("resume_unavailable", {"message": "Sesi sebelumnya tidak ditemukan."}, to=sid)
            return
        room_id, room, player = found
        old_sid = player.get("sid")
        if old_sid:
            ctrl.player_sid_to_identity.pop(old_sid, None)

    await attach_player(sid, room_id, player)
    await emit_joined(sid, room_id, player)


@sio.on("player_voice_token_request")
async def on_player_voice_token_request(sid, data=None):
    with ctrl.lock:
        identity = ctrl.player_sid_to_identity.get(sid)
        if not identity:
            await sio.emit("voice_error", {"message": "Kamu harus bergabung ke Room terlebih dahulu."}, to=sid)
            return
        room_id, player_id = identity
        room = ctrl.rooms.get(room_id)
        player = room["players"].get(player_id) if room else None
        if not player or not player.get("online"):
            await sio.emit("voice_error", {"message": "Sesi peserta tidak ditemukan atau offline."}, to=sid)
            return
        try:
            team_room = ctrl.livekit_team_room(room_id, player["team"])
            token = ctrl.create_livekit_token(
                identity=f"player-{player_id}",
                name=player["name"],
                room_name=team_room,
                can_publish=False,
            )
        except Exception:
            await sio.emit("voice_error", {"message": "Gagal membuat akses audio. Periksa konfigurasi LiveKit."}, to=sid)
            return

    await sio.emit(
        "player_voice_token",
        {
            "url": LIVEKIT_URL,
            "token": token,
            "team": player["team"],
            "room_name": team_room,
        },
        to=sid,
    )


@sio.on("host_voice_tokens_request")
async def on_host_voice_tokens_request(sid, data=None):
    data = data or {}
    room_id = str(data.get("room_id") or "").strip().upper()
    token = ctrl.clean_token(data.get("host_token"))

    with ctrl.lock:
        room = ctrl.rooms.get(room_id)
        registered_token = ctrl.host_sid_to_token.get(sid)
        if not room or not token or room["host_token"] != token or registered_token != token:
            await sio.emit("voice_error", {"message": "Akses suara Host tidak valid."}, to=sid)
            return
        try:
            channels = {}
            for team_key in get_room_teams(room):
                lk_room = ctrl.livekit_team_room(room_id, team_key)
                lk_token = ctrl.create_livekit_token(
                    identity=f"host-{room_id}-command",
                    name=f"Command - {room['host_name']} ({team_key})",
                    room_name=lk_room,
                    can_publish=True,
                )
                channels[team_key] = {"room_name": lk_room, "token": lk_token}
        except Exception:
            await sio.emit("voice_error", {"message": "Gagal membuat akses suara Command."}, to=sid)
            return

    await sio.emit(
        "host_voice_tokens",
        {
            "url": LIVEKIT_URL,
            "channels": channels,
            "red": channels.get("merah"),
            "blue": channels.get("biru"),
        },
        to=sid,
    )


@sio.on("send_text")
async def on_send_text(sid, data=None):
    data = data or {}
    with ctrl.lock:
        identity = ctrl.player_sid_to_identity.get(sid)
        if not identity:
            await sio.emit("message_error", {"message": "Hanya peserta yang dapat mengirim pesan."}, to=sid)
            return
        room_id, player_id = identity
        room = ctrl.rooms.get(room_id)
        player = room["players"].get(player_id) if room else None
        if not player:
            await sio.emit("message_error", {"message": "Sesi peserta tidak ditemukan."}, to=sid)
            return
        message = str(data.get("message") or "").strip()
        if not message:
            return
        if len(message) > 1000:
            await sio.emit("message_error", {"message": "Pesan maksimal 1000 karakter."}, to=sid)
            return
        source = data.get("source") if data.get("source") in {"text", "voice"} else "text"
        payload = {
            "room_id": room_id,
            "message_id": str(uuid.uuid4()),
            "player_id": player_id,
            "name": player["name"],
            "team": player["team"],
            "team_label": format_team_label(player["team"], room),
            "message": message,
            "source": source,
            "timestamp": ctrl.now_iso(),
        }
        history = room["team_messages"].setdefault(player["team"], [])
        history.append(payload)
        if len(history) > ctrl.MAX_MESSAGES_PER_TEAM:
            del history[:-ctrl.MAX_MESSAGES_PER_TEAM]

    await sio.emit("chat_update", payload, room=ctrl.team_channel(room_id, player["team"]))
    await sio.emit("host_chat_update", payload, room=ctrl.host_channel(room_id))


@sio.on("player_leave_room")
async def on_player_leave_room(sid, data=None):
    with ctrl.lock:
        identity = ctrl.player_sid_to_identity.pop(sid, None)
        if not identity:
            await sio.emit("player_left", {"ok": True}, to=sid)
            return
        room_id, player_id = identity
        room = ctrl.rooms.get(room_id)
        player = room["players"].pop(player_id, None) if room else None

    if player:
        await sio.emit(
            "system_notice",
            {"message": f"{player['name']} keluar dari channel tim.", "kind": "leave"},
            room=ctrl.team_channel(room_id, player["team"]),
        )
        await emit_roster(room_id)
    await sio.emit("player_left", {"ok": True, "room_id": room_id}, to=sid)


@sio.on("host_close_room")
async def on_host_close_room(sid, data=None):
    data = data or {}
    room_id = str(data.get("room_id") or "").strip().upper()
    token = ctrl.clean_token(data.get("host_token"))
    with ctrl.lock:
        room = ctrl.rooms.get(room_id)
        if not room or not token or room["host_token"] != token:
            await sio.emit("host_error", {"message": "Tidak memiliki izin menutup Room ini."}, to=sid)
            return
        for player in list(room["players"].values()):
            if player.get("sid"):
                ctrl.player_sid_to_identity.pop(player["sid"], None)
        ctrl.rooms.pop(room_id, None)

    await sio.emit(
        "room_closed",
        {"room_id": room_id, "message": "Room telah ditutup oleh Host."},
        room=ctrl.room_channel(room_id),
    )
    await sio.emit("host_room_closed", {"room_id": room_id}, to=sid)
    await broadcast_room_list()


@sio.event
async def disconnect(sid):
    with ctrl.lock:
        ctrl.host_sid_to_token.pop(sid, None)
        identity = ctrl.player_sid_to_identity.pop(sid, None)
        if not identity:
            return
        room_id, player_id = identity
        room = ctrl.rooms.get(room_id)
        player = room["players"].get(player_id) if room else None
        if player:
            player["online"] = False
            player["sid"] = None

    if player:
        await sio.emit(
            "system_notice",
            {"message": f"{player['name']} terputus dari koneksi.", "kind": "offline"},
            room=ctrl.team_channel(room_id, player["team"]),
        )
        await emit_roster(room_id)