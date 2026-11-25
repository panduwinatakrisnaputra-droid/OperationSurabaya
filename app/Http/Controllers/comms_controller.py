import re
import uuid
import threading
from datetime import datetime, timezone, timedelta
from livekit import api
from config.config import LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET

MAX_ACTIVE_ROOMS = 10
MAX_PLAYERS_PER_TEAM = 10
MAX_MESSAGES_PER_TEAM = 300
VALID_TEAMS = {"merah", "biru"}
ROOM_RE = re.compile(r"^TC-[A-Z0-9]{6}$")

# Penyimpanan state di RAM (sama seperti server_2.py)
rooms = {}                    # room_id -> room state
host_sid_to_token = {}        # socket sid -> host token
player_sid_to_identity = {}   # socket sid -> (room_id, player_id)
lock = threading.RLock()


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def create_livekit_token(identity: str, name: str, room_name: str, can_publish: bool) -> str:
    if not LIVEKIT_URL or not LIVEKIT_API_KEY or not LIVEKIT_API_SECRET:
        raise RuntimeError("Konfigurasi LiveKit belum lengkap di .env.")

    token = (
        api.AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET)
        .with_identity(identity)
        .with_name(name)
        .with_ttl(timedelta(hours=1))
        .with_grants(
            api.VideoGrants(
                room_join=True,
                room=room_name,
                can_publish=can_publish,
                can_subscribe=True,
                can_publish_data=False,
            )
        )
        .to_jwt()
    )
    return token


def livekit_team_room(room_id: str, team: str) -> str:
    return f"{room_id}-{team}"


def room_channel(room_id: str) -> str:
    return f"room:{room_id}:all"


def team_channel(room_id: str, team: str) -> str:
    return f"room:{room_id}:team:{team}"


def host_channel(room_id: str) -> str:
    return f"room:{room_id}:host"


def clean_name(value):
    value = str(value or "").strip()
    return value if 1 <= len(value) <= 30 else None


def clean_token(value):
    value = str(value or "").strip()
    return value if 20 <= len(value) <= 120 else None


def room_summary(room: dict) -> dict:
    return {
        "room_id": room["room_id"],
        "created_at": room["created_at"],
        "host_name": room["host_name"],
        "red_count": sum(1 for p in room["players"].values() if p["team"] == "merah"),
        "blue_count": sum(1 for p in room["players"].values() if p["team"] == "biru"),
        "red_online": sum(1 for p in room["players"].values() if p["team"] == "merah" and p["online"]),
        "blue_online": sum(1 for p in room["players"].values() if p["team"] == "biru" and p["online"]),
    }


def public_rooms() -> list:
    return [room_summary(r) for r in sorted(rooms.values(), key=lambda x: x["created_at"])]


def roster_for(room: dict, team=None) -> list:
    players = []
    for p in room["players"].values():
        if team and p["team"] != team:
            continue
        players.append({
            "player_id": p["player_id"],
            "name": p["name"],
            "team": p["team"],
            "online": p["online"],
        })
    return players


def make_player(name: str, team: str, token: str) -> dict:
    return {
        "player_id": str(uuid.uuid4()),
        "player_token": token,
        "name": name,
        "team": team,
        "online": True,
        "sid": None,
        "joined_at": now_iso(),
    }