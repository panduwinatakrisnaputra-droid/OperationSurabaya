from collections import defaultdict
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter(tags=["Referee Camera"])

VALID_SLOTS = {
    "red-1": "CAMERA 1 · RED TEAM",
    "red-2": "CAMERA 2 · RED TEAM",
    "blue-1": "CAMERA 1 · BLUE TEAM",
    "blue-2": "CAMERA 2 · BLUE TEAM",
    "green-1": "CAMERA 1 · GREEN TEAM",
    "green-2": "CAMERA 2 · GREEN TEAM",
    "yellow-1": "CAMERA 1 · YELLOW TEAM",
    "yellow-2": "CAMERA 2 · YELLOW TEAM",
}

# Struktur: rooms[match_id][slot_id] = {"referee": WebSocket | None, "admins": set[WebSocket]}
rooms: dict[str, dict[str, dict[str, object]]] = defaultdict(
    lambda: defaultdict(lambda: {"referee": None, "admins": set()})
)


@router.get("/api/referee-cam/status/{match_id}")
async def get_referee_cam_status(match_id: str):
    match_rooms = rooms.get(match_id, {})
    status = {}
    for slot_id, label in VALID_SLOTS.items():
        slot_data = match_rooms.get(slot_id)
        is_online = bool(slot_data and slot_data.get("referee") is not None)
        status[slot_id] = {
            "slot_id": slot_id,
            "label": label,
            "online": is_online,
        }
    return {"match_id": match_id, "slots": status}


@router.websocket("/ws/referee-cam/{match_id}/{slot_id}")
async def referee_cam_slot_ws(
    websocket: WebSocket,
    match_id: str,
    slot_id: str,
    role: str = "referee",
):
    await websocket.accept()
    slot_room = rooms[match_id][slot_id]
    admins: set[WebSocket] = slot_room["admins"]  # type: ignore

    if role == "referee":
        slot_room["referee"] = websocket
        for admin_ws in list(admins):
            try:
                await admin_ws.send_json(
                    {
                        "type": "referee-status",
                        "slot_id": slot_id,
                        "label": VALID_SLOTS.get(slot_id, slot_id.upper()),
                        "online": True,
                    }
                )
            except Exception:
                admins.discard(admin_ws)
    else:
        admins.add(websocket)
        referee_ws: WebSocket | None = slot_room["referee"]  # type: ignore
        await websocket.send_json(
            {
                "type": "referee-status",
                "slot_id": slot_id,
                "label": VALID_SLOTS.get(slot_id, slot_id.upper()),
                "online": referee_ws is not None,
            }
        )

    try:
        while True:
            data = await websocket.receive_json()
            data["slot_id"] = slot_id
            data["label"] = VALID_SLOTS.get(slot_id, slot_id.upper())

            if role == "referee":
                for admin_ws in list(admins):
                    try:
                        await admin_ws.send_json(data)
                    except Exception:
                        admins.discard(admin_ws)
            else:
                referee_ws: WebSocket | None = slot_room["referee"]  # type: ignore
                if referee_ws is not None:
                    await referee_ws.send_json(data)
    except WebSocketDisconnect:
        if role == "referee":
            if slot_room["referee"] is websocket:
                slot_room["referee"] = None
            for admin_ws in list(admins):
                try:
                    await admin_ws.send_json(
                        {
                            "type": "referee-status",
                            "slot_id": slot_id,
                            "label": VALID_SLOTS.get(slot_id, slot_id.upper()),
                            "online": False,
                        }
                    )
                except Exception:
                    admins.discard(admin_ws)
        else:
            admins.discard(websocket)