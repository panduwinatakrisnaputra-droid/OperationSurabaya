import os
import json
import math
import uuid
import base64
from typing import List, Optional, Dict, Any, Tuple
from fastapi import HTTPException
from config.database import supabase, supabase_auth
from config.config import SUPABASE_URL, SUPABASE_KEY
from app.Models.player import PlayerRegister, PlayerLogin, PlayerFaceLogin, PlayerLogout

# Coba import OpenCV dan face_recognition (Example 6.13 & 6.14)
try:
    import cv2
    import numpy as np
    HAS_OPENCV = True
except ImportError:
    HAS_OPENCV = False

try:
    import face_recognition
    HAS_FACE_RECOGNITION = True
except ImportError:
    HAS_FACE_RECOGNITION = False

CASCADE_PATH = r"C:\programming\artificial_intelligence_programming\CHAPTER-6\haarcascade_frontalface_default.xml"
if not os.path.exists(CASCADE_PATH):
    CASCADE_PATH = "haarcascade_frontalface_default.xml"

face_cascade = cv2.CascadeClassifier(CASCADE_PATH) if (HAS_OPENCV and os.path.exists(CASCADE_PATH)) else None

STORAGE_FILE = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "storage",
    "data",
    "faces.json"
)

def _load_faces() -> List[Dict[str, Any]]:
    if not os.path.exists(STORAGE_FILE):
        return []
    try:
        with open(STORAGE_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return []

def _save_faces(faces: List[Dict[str, Any]]) -> None:
    os.makedirs(os.path.dirname(STORAGE_FILE), exist_ok=True)
    with open(STORAGE_FILE, "w", encoding="utf-8") as f:
        json.dump(faces, f, indent=2)

def _euclidean_distance(v1: List[float], v2: List[float]) -> float:
    return math.sqrt(sum((a - b) ** 2 for a, b in zip(v1, v2)))


def extract_descriptor_from_base64(b64_string: str) -> List[float]:
    """
    Ekstrak 128D Face Descriptor dari gambar Base64 (Snapshot dari Webcam Halaman Website)
    Menggunakan teknik Example 6.14 (face_recognition / dlib) dan fallback OpenCV Haar Cascade (Example 6.13)
    """
    if not HAS_OPENCV:
        raise HTTPException(status_code=500, detail="OpenCV tidak terinstal di server backend.")

    if "," in b64_string:
        b64_string = b64_string.split(",", 1)[1]

    try:
        raw_bytes = base64.b64decode(b64_string)
        nparr = np.frombuffer(raw_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None:
            raise ValueError("Gagal mendecode frame gambar dari webcam.")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Data gambar webcam tidak valid: {str(e)}")

    # 1. Gunakan face_recognition (Example 6.14) jika tersedia
    if HAS_FACE_RECOGNITION:
        rgb_img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        locations = face_recognition.face_locations(rgb_img)
        if not locations:
            raise HTTPException(
                status_code=400,
                detail="Tidak ada wajah yang terdeteksi di kamera! Pastikan wajah Anda menghadap lurus dan pencahayaan terang."
            )
        encodings = face_recognition.face_encodings(rgb_img, locations)
        if not encodings:
            raise HTTPException(status_code=400, detail="Gagal mengekstrak fitur wajah.")
        return encodings[0].tolist()

    # 2. Fallback menggunakan OpenCV Haar Cascade (Example 6.13)
    elif face_cascade is not None:
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        faces = face_cascade.detectMultiScale(gray, 1.3, 5)
        if len(faces) == 0:
            raise HTTPException(
                status_code=400,
                detail="Wajah tidak terdeteksi oleh OpenCV Haar Cascade! Arahkan wajah lurus ke kamera."
            )
        x, y, w, h = faces[0]
        # Normalisasi crop wajah ke 128 fitur float
        face_roi = cv2.resize(gray[y:y+h, x:x+w], (16, 8))
        norm_desc = (face_roi.flatten() / 255.0).tolist()
        return norm_desc

    else:
        raise HTTPException(status_code=500, detail="Model pengenal wajah backend belum siap.")


def register_face_player(player: PlayerRegister):
    """
    Registrasi pemain dengan pemindaian biometrik wajah.
    Menerima snapshot gambar Base64 dari webcam website atau face_descriptor.
    """
    player_number = int(player.player_number)
    username = player.username.strip()
    full_name = player.full_name.strip()
    email = player.email.strip().lower() if player.email else f"{username}@operation-surabaya.local"

    if not 1 <= player_number <= 999:
        raise HTTPException(status_code=422, detail="Player ID harus berupa angka 1 sampai 999.")

    # Dapatkan descriptor
    if player.image_base64:
        face_desc = extract_descriptor_from_base64(player.image_base64)
    elif player.face_descriptor and len(player.face_descriptor) == 128:
        face_desc = player.face_descriptor
    else:
        raise HTTPException(
            status_code=400,
            detail="Snapshot kamera webcam atau deskriptor biometrik wajah wajib dikirim."
        )

    faces = _load_faces()

    # Player ID harus unik secara global. Periksa data lokal terlebih dahulu.
    for existing in faces:
        if existing.get("player_number") is not None and int(existing["player_number"]) == player_number:
            raise HTTPException(
                status_code=409,
                detail=f"Player ID {player_number} sudah digunakan oleh pemain lain. Silakan pilih nomor berbeda."
            )

    # Periksa keunikan wajah (apakah wajah sudah pernah terdaftar)
    for existing in faces:
        dist = _euclidean_distance(face_desc, existing["face_descriptor"])
        if dist < 0.48:
            raise HTTPException(
                status_code=409,
                detail=f"Wajah ini sudah terdaftar sebagai '{existing['username']}' ({existing['full_name']}). Silakan langsung Login!"
            )

    # Periksa keunikan username
    for existing in faces:
        if existing["username"].lower() == username.lower():
            raise HTTPException(
                status_code=409,
                detail=f"Username '{username}' sudah digunakan. Silakan pilih username lain."
            )

    # Simpan ke Supabase. Unique index pada database menjadi pengaman utama
    # terhadap dua registrasi bersamaan dengan nomor yang sama.
    player_id = str(uuid.uuid4())
    try:
        duplicate = (
            supabase.table("players")
            .select("id")
            .eq("player_number", player_number)
            .limit(1)
            .execute()
        )
        if duplicate.data:
            raise HTTPException(
                status_code=409,
                detail=f"Player ID {player_number} sudah digunakan. Silakan pilih nomor berbeda."
            )

        supabase_res = (
            supabase.table("players")
            .insert({
                "player_number": player_number,
                "username": username,
                "full_name": full_name,
                "email": email,
                "status": "offline"
            })
            .execute()
        )
        if not supabase_res.data:
            raise HTTPException(status_code=500, detail="Data pemain tidak berhasil disimpan ke Supabase.")
        player_id = supabase_res.data[0].get("id", player_id)
    except HTTPException:
        raise
    except Exception as exc:
        error_text = str(exc).lower()
        if "player_number" in error_text and ("duplicate" in error_text or "unique" in error_text or "23505" in error_text):
            raise HTTPException(status_code=409, detail=f"Player ID {player_number} sudah digunakan. Silakan pilih nomor berbeda.")
        if "player_number" in error_text and ("column" in error_text or "schema cache" in error_text or "does not exist" in error_text):
            raise HTTPException(status_code=500, detail="Kolom player_number belum tersedia. Jalankan player_number_migration.sql di Supabase terlebih dahulu.")
        raise HTTPException(status_code=500, detail=f"Gagal menyimpan pemain ke Supabase: {str(exc)}")

    new_player = {
        "id": player_id,
        "player_number": player_number,
        "username": username,
        "full_name": full_name,
        "email": email,
        "status": "offline",
        "face_descriptor": face_desc
    }
    faces.append(new_player)
    _save_faces(faces)

    return {
        "success": True,
        "message": f"Wajah berhasil didaftarkan untuk pemain {username} ({full_name})!",
        "player": {
            "id": new_player["id"],
            "player_number": new_player["player_number"],
            "username": new_player["username"],
            "full_name": new_player["full_name"],
            "email": new_player["email"],
            "status": new_player["status"]
        }
    }


def login_face_player(data: PlayerFaceLogin):
    """
    Login otomatis dari halaman website menggunakan snapshot webcam (1:N face matching).
    """
    if data.image_base64:
        face_desc = extract_descriptor_from_base64(data.image_base64)
    elif data.face_descriptor and len(data.face_descriptor) == 128:
        face_desc = data.face_descriptor
    else:
        raise HTTPException(
            status_code=400,
            detail="Snapshot kamera webcam atau deskriptor biometrik wajah wajib dikirim."
        )

    faces = _load_faces()
    if not faces:
        raise HTTPException(
            status_code=404,
            detail="Belum ada profil pemain yang terdaftar. Silakan registrasi terlebih dahulu!"
        )

    best_match = None
    min_dist = float("inf")
    # Ambang batas pencocokan Euclidean Distance (0.50 ~ 0.54)
    THRESHOLD = 0.54

    for candidate in faces:
        dist = _euclidean_distance(face_desc, candidate["face_descriptor"])
        if dist < min_dist:
            min_dist = dist
            best_match = candidate

    if min_dist > THRESHOLD or not best_match:
        raise HTTPException(
            status_code=401,
            detail=f"Wajah tidak dikenali dalam sistem (akurasi jarak: {min_dist:.2f}). Pastikan wajah Anda menghadap lurus ke kamera."
        )

    try:
        supabase.table("players").update({"status": "online"}).eq("id", best_match["id"]).execute()
    except Exception:
        pass

    match_percent = max(0.0, min(100.0, round((1.0 - (min_dist / THRESHOLD)) * 100, 1)))

    return {
        "success": True,
        "message": f"Identitas terverifikasi: Selamat datang kembali, {best_match['full_name']}!",
        "confidence": match_percent,
        "player": {
            "id": best_match["id"],
            "player_number": best_match.get("player_number"),
            "username": best_match["username"],
            "full_name": best_match["full_name"],
            "email": best_match["email"],
            "status": "online"
        },
        "session": {
            "access_token": f"face_session_{best_match['id']}",
            "token_type": "bearer"
        }
    }


def register_player(player: PlayerRegister):
    """Router pembantu pendaftaran."""
    return register_face_player(player)


def login_player(player: PlayerLogin):
    """Fallback login manual lama jika dibutuhkan."""
    try:
        email = player.email.strip().lower()
        faces = _load_faces()
        for p in faces:
            if p.get("email") == email:
                return {
                    "success": True,
                    "player": p,
                    "session": {"access_token": f"sess_{p['id']}"}
                }
        raise HTTPException(status_code=401, detail="Email atau password salah.")
    except Exception as e:
        raise HTTPException(status_code=401, detail=str(e))


def logout_player(data: PlayerLogout):
    return {
        "success": True,
        "message": "Pemain berhasil logout."
    }


def get_players():
    try:
        response = supabase.table("players").select("id, player_number, username, full_name, email, status").execute()
        if response.data:
            return {"success": True, "data": response.data}
    except Exception:
        pass

    faces = _load_faces()
    clean = [{k: v for k, v in f.items() if k != "face_descriptor"} for f in faces]
    return {"success": True, "data": clean}
