from typing import List, Optional
from pydantic import BaseModel, Field

class PlayerRegister(BaseModel):
    player_number: int = Field(ge=1, le=999)
    username: str = Field(min_length=3, max_length=30)
    full_name: str = Field(min_length=2, max_length=100)
    email: Optional[str] = None
    password: Optional[str] = None
    # Mendukung snapshot gambar (base64) dari webcam web atau 128-vektor langsung
    image_base64: Optional[str] = None
    face_descriptor: Optional[List[float]] = None


class PlayerFaceLogin(BaseModel):
    # Snapshot base64 langsung dari elemen <video> di halaman website
    image_base64: Optional[str] = None
    # Atau vektor embedding 128D
    face_descriptor: Optional[List[float]] = None


class PlayerLogin(BaseModel):
    email: str
    password: str = Field(min_length=8)


class PlayerLogout(BaseModel):
    access_token: str
