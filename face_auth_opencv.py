"""
OPERATION: SURABAYA - Desktop Face Authenticator
Diadaptasi dari Example 6.13 (OpenCV Haar Cascade) & Example 6.14 (face_recognition / dlib)
Terintegrasi langsung dengan Backend Operation Surabaya & Browser Portal.
"""

import os
import sys
import time
import json
import urllib.request
import urllib.error
import cv2
import numpy as np

# Coba import face_recognition (Example 6.14)
try:
    import face_recognition
    USE_FACE_RECOGNITION = True
except ImportError:
    USE_FACE_RECOGNITION = False

CASCADE_PATH = r"C:\programming\artificial_intelligence_programming\CHAPTER-6\haarcascade_frontalface_default.xml"
if not os.path.exists(CASCADE_PATH):
    CASCADE_PATH = "haarcascade_frontalface_default.xml"

detector = cv2.CascadeClassifier(CASCADE_PATH) if os.path.exists(CASCADE_PATH) else None
API_BASE = "http://127.0.0.1:8000"


def send_api(endpoint: str, data: dict):
    url = f"{API_BASE}{endpoint}"
    payload = json.dumps(data).encode("utf-8")
    req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8")
        try:
            parsed = json.loads(err_body)
            return {"error": parsed.get("detail", str(e))}
        except Exception:
            return {"error": err_body}
    except Exception as e:
        return {"error": str(e)}


def extract_face_descriptor(frame):
    """
    Ekstrak 128-vektor wajah dari frame OpenCV sesuai konsep Example 6.14
    """
    rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    if USE_FACE_RECOGNITION:
        locations = face_recognition.face_locations(rgb_frame)
        if not locations:
            return None, None
        encodings = face_recognition.face_encodings(rgb_frame, locations)
        if not encodings:
            return None, None
        return encodings[0].tolist(), locations[0]
    else:
        # Fallback Haar Cascade jika face_recognition tidak tersedia
        if detector is None:
            return None, None
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        faces = detector.detectMultiScale(gray, 1.3, 5)
        if len(faces) == 0:
            return None, None
        x, y, w, h = faces[0]
        # Buat vektor dummy terukur
        resized = cv2.resize(gray[y:y+h, x:x+w], (16, 8))
        norm = resized.flatten() / 255.0
        return norm.tolist(), (y, x+w, y+h, x)


def run_authenticator():
    print("=" * 60)
    print("OPERATION: SURABAYA - NATIVE OPENCV FACE AUTHENTICATOR")
    print("=" * 60)
    print("Membuka kamera laptop/webcam via OpenCV...")

    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        print("[ERROR] Webcam tidak dapat dibuka oleh OpenCV!")
        print("Pastikan kamera tidak sedang dipakai oleh aplikasi lain (Zoom/OBS/Browser).")
        return

    mode = "IDLE"  # "IDLE", "REGISTER", "LOGIN"
    reg_username = ""
    reg_fullname = ""
    message = "Tekan [L] untuk Login Wajah | [R] untuk Registrasi | [Q] untuk Keluar"
    color = (255, 255, 255)

    cv2.namedWindow("OPERATION SURABAYA - Face Authenticator", cv2.WINDOW_AUTOSIZE)

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        descriptor, loc = extract_face_descriptor(frame)

        if loc is not None:
            top, right, bottom, left = loc
            # Kotak hijau jika wajah terdeteksi
            cv2.rectangle(frame, (left, top), (right, bottom), (0, 255, 128), 2)
            cv2.putText(frame, "WAJAH TERDETEKSI", (left, top - 10),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 128), 2)

        # Header status bar
        cv2.rectangle(frame, (0, 0), (frame.shape[1], 45), (15, 20, 25), -1)
        cv2.putText(frame, message, (15, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.55, color, 1)

        cv2.imshow("OPERATION SURABAYA - Face Authenticator", frame)
        key = cv2.waitKey(20) & 0xFF

        if key == ord('q') or key == ord('Q') or key == 27:
            break

        elif key == ord('l') or key == ord('L'):
            if descriptor is None:
                message = "[!] Wajah belum terlihat jelas di kamera! Arahkan wajah lurus."
                color = (0, 165, 255)
            else:
                message = "[...] Memverifikasi wajah ke server..."
                color = (255, 255, 0)
                cv2.imshow("OPERATION SURABAYA - Face Authenticator", frame)
                cv2.waitKey(1)

                res = send_api("/api/players/face-login", {"face_descriptor": descriptor})
                if "error" in res:
                    message = f"[GAGAL] {res['error']}"
                    color = (0, 0, 255)
                else:
                    player_name = res.get("player", {}).get("full_name", "Pemain")
                    conf = res.get("confidence", 100)
                    message = f"[SUKSES] Selamat datang, {player_name}! (Match: {conf}%)"
                    color = (0, 255, 0)
                    print(f"\n[LOGIN BERHASIL] {res.get('message')}")

        elif key == ord('r') or key == ord('R'):
            if descriptor is None:
                message = "[!] Arahkan wajah ke kamera sebelum registrasi!"
                color = (0, 165, 255)
            else:
                # Minta input username & full name via console terminal
                print("\n" + "=" * 50)
                print("[FORM REGISTRASI PEMAIN]")
                username = input("Masukkan Username (misal: ghost01): ").strip()
                fullname = input("Masukkan Nama Lengkap: ").strip()

                if not username or not fullname:
                    message = "[!] Username dan Nama Lengkap wajib diisi!"
                    color = (0, 0, 255)
                else:
                    message = f"[...] Mendaftarkan biometrik wajah {username}..."
                    color = (255, 255, 0)
                    res = send_api("/api/players/register", {
                        "username": username,
                        "full_name": fullname,
                        "face_descriptor": descriptor
                    })
                    if "error" in res:
                        message = f"[GAGAL] {res['error']}"
                        color = (0, 0, 255)
                    else:
                        message = f"[SUKSES] Wajah {username} berhasil didaftarkan! Tekan [L] untuk Login."
                        color = (0, 255, 0)
                        print(f"[REGISTRASI BERHASIL] {res.get('message')}\n")

    cap.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    run_authenticator()
