"""Layanan deteksi plat tim (warna/bentuk) dan nomor pemain (1-10) memakai YOLO11 + verifikasi range warna HSV."""

from pathlib import Path
import threading
import cv2
import numpy as np
from paket_model_plat.plat_detector import PlatDetector

ROOT_DIR = Path(__file__).resolve().parent.parent.parent
PLAT_WEIGHTS = ROOT_DIR / "paket_model_plat" / "plat_best.pt"
DIGIT_WEIGHTS = ROOT_DIR / "paket_model_plat" / "digit_best.pt"

PLAT_TIM_TO_TEAM_CODE = {
    "merah": "RED",
    "biru": "BLUE",
    "hijau": "GREEN",
    "hitam": "BLACK",
}

_detector = None
_lock = threading.Lock()


def _load():
  global _detector
  if _detector is not None:
    return
  for p in (PLAT_WEIGHTS, DIGIT_WEIGHTS):
    if not p.exists():
      raise RuntimeError(f"File model plat tidak ditemukan: {p}")
  _detector = PlatDetector(
      plat_weights=str(PLAT_WEIGHTS),
      digit_weights=str(DIGIT_WEIGHTS),
  )


def _cek_range_warna_hsv(frame, bbox):
  """Cek apakah piksel berwarna di dalam kotak plat masuk ke range HSV Merah, Biru, atau Hijau."""
  x1, y1, x2, y2 = [int(v) for v in bbox]
  crop = frame[max(0, y1) : max(0, y2), max(0, x1) : max(0, x2)]
  if crop.size == 0:
    return None

  hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
  mask_warna = (hsv[:, :, 1] > 65) & (hsv[:, :, 2] > 50)
  h_valid = hsv[:, :, 0][mask_warna]
  if len(h_valid) < 30:
    return None

  piksel_merah = np.sum((h_valid <= 12) | (h_valid >= 165))
  piksel_hijau = np.sum((h_valid >= 35) & (h_valid <= 85))
  piksel_biru = np.sum((h_valid >= 95) & (h_valid <= 135))

  skor = {
      "merah": int(piksel_merah),
      "hijau": int(piksel_hijau),
      "biru": int(piksel_biru),
  }
  warna_dominan = max(skor, key=skor.get)
  if skor[warna_dominan] / len(h_valid) >= 0.35:
    return warna_dominan
  return None


def detect_plates(frame):
  """Mendeteksi semua plat valid di frame dan memilih target yang paling dekat tengah layar."""
  _load()
  h, w = frame.shape[:2]
  with _lock:
    raw_plates = _detector.predict(frame, use_stabilizer=False)

  plates = []
  best_target = None
  best_center_dist = float("inf")

  for p in raw_plates:
    x1, y1, x2, y2 = p["bbox"]
    norm_box = {
        "x": round(x1 / w, 4),
        "y": round(y1 / h, 4),
        "w": round((x2 - x1) / w, 4),
        "h": round((y2 - y1) / h, 4),
    }
    tim_raw = p["tim"].lower()

    if tim_raw != "hitam" and p["conf_tim"] < 0.75:
      warna_hsv = _cek_range_warna_hsv(frame, p["bbox"])
      if warna_hsv:
        tim_raw = warna_hsv

    item = {
        "tim": tim_raw,
        "team_code": PLAT_TIM_TO_TEAM_CODE.get(tim_raw, tim_raw.upper()),
        "nomor": int(p["nomor"]),
        "confidence_tim": p["conf_tim"],
        "confidence_nomor": p["conf_nomor"],
        "box": norm_box,
    }
    plates.append(item)

    cx = norm_box["x"] + (norm_box["w"] / 2.0)
    cy = norm_box["y"] + (norm_box["h"] / 2.0)
    dist = ((cx - 0.5) ** 2 + (cy - 0.5) ** 2) ** 0.5
    if dist < best_center_dist:
      best_center_dist = dist
      best_target = item

  return {
      "detected": len(plates) > 0,
      "plates": plates,
      "target_plate": best_target,
  }