"""Deteksi pistol kardus (YOLOv4-tiny Darknet) memakai OpenCV DNN.

Butuh OpenCV 4.x (OpenCV 5 tidak mendukung format Darknet).
"""
import base64
import re
import threading
from pathlib import Path

import cv2
import numpy as np

MODEL_DIR = Path(__file__).resolve().parent.parent / "storage" / "models" / "yolo"
CFG_PATH = MODEL_DIR / "yolov4-tiny-obj.cfg"
WEIGHTS_PATH = MODEL_DIR / "yolov4-tiny-obj_best.weights"
NAMES_PATH = MODEL_DIR / "obj.names"

TARGET_CLASS = "cardboard_gun_phone"
CONF_THRESHOLD = 0.30
NMS_THRESHOLD = 0.4

_model = None
_names = []
_lock = threading.Lock()  # cv2.dnn tidak thread-safe


def _net_size():
    text = CFG_PATH.read_text()
    w = re.search(r"(?m)^width\s*=\s*(\d+)", text)
    h = re.search(r"(?m)^height\s*=\s*(\d+)", text)
    return int(w.group(1)), int(h.group(1))


def _load():
    global _model, _names
    if _model is not None:
        return
    if int(cv2.__version__.split(".")[0]) >= 5:
        raise RuntimeError("OpenCV 5 tidak mendukung model Darknet. Pasang opencv-contrib-python<5.")
    for p in (CFG_PATH, WEIGHTS_PATH, NAMES_PATH):
        if not p.exists():
            raise RuntimeError(f"File model tidak ditemukan: {p}")
    _names = [l.strip() for l in NAMES_PATH.read_text(encoding="utf-8").splitlines() if l.strip()]
    model = cv2.dnn_DetectionModel(str(WEIGHTS_PATH), str(CFG_PATH))
    model.setInputParams(size=_net_size(), scale=1 / 255.0, swapRB=True)
    _model = model


def decode_image(data_url: str):
    """Decode base64 (boleh berawalan data:image/jpeg;base64,) menjadi frame BGR."""
    if not data_url:
        return None
    if "," in data_url:
        data_url = data_url.split(",", 1)[1]
    try:
        raw = base64.b64decode(data_url, validate=False)
    except Exception:
        return None
    frame = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
    return frame


# Crosshair berada tepat di tengah frame kamera (0.5, 0.5).
CROSSHAIR = (0.5, 0.5)
CROSSHAIR_MARGIN = 0.01  # toleransi kecil (1% lebar/tinggi frame)


def _contains(box, point=CROSSHAIR, margin=CROSSHAIR_MARGIN):
    px, py = point
    return (box["x"] - margin <= px <= box["x"] + box["w"] + margin
            and box["y"] - margin <= py <= box["y"] + box["h"] + margin)


def detect_gun(frame):
    """Kembalikan {detected, on_target, confidence, box} (box dinormalisasi 0..1: x,y,w,h).

    on_target = True bila crosshair (tengah frame) berada di dalam bounding box senjata.
    """
    _load()
    h, w = frame.shape[:2]
    with _lock:
        class_ids, scores, boxes = _model.detect(frame, confThreshold=CONF_THRESHOLD, nmsThreshold=NMS_THRESHOLD)
    best = None      # deteksi dengan confidence tertinggi
    best_hit = None  # deteksi tertinggi yang dikenai crosshair
    for cid, sc, box in zip(np.array(class_ids).flatten(), np.array(scores).flatten(), boxes):
        name = _names[int(cid)] if int(cid) < len(_names) else str(int(cid))
        if name != TARGET_CLASS:
            continue
        x, y, bw, bh = [int(v) for v in box]
        norm = {"x": x / w, "y": y / h, "w": bw / w, "h": bh / h}
        item = (float(sc), norm)
        if best is None or item[0] > best[0]:
            best = item
        if _contains(norm) and (best_hit is None or item[0] > best_hit[0]):
            best_hit = item
    if best is None:
        return {"detected": False, "on_target": False, "confidence": 0.0, "box": None}
    chosen = best_hit or best
    return {
        "detected": True,
        "on_target": best_hit is not None,
        "confidence": round(chosen[0], 3),
        "box": chosen[1],
    }
