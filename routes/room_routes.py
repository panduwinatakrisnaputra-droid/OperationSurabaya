from typing import Optional
from fastapi import APIRouter
from app.Models.match import CreateRoomRequest, JoinRoomByCodeRequest
from app.Http.Controllers import room_controller

router = APIRouter(prefix="/api/rooms", tags=["Rooms"])

@router.get("")
def get_rooms(
    status: str = "all",
    search: str = "",
    page: int = 1,
    page_size: int = 20
):
    return room_controller.get_rooms(status=status, search=search, page=page, page_size=page_size)

@router.post("/create")
def create_room(data: CreateRoomRequest):
    return room_controller.create_room(data)

@router.post("/join")
def join_room_by_code(data: JoinRoomByCodeRequest):
    return room_controller.join_room_by_code(data)
