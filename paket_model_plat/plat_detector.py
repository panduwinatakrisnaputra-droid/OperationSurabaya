from collections import Counter, deque
import math
import cv2
from ultralytics import YOLO


class PlatDetector:
  """Modul deteksi tim (hijau/merah/biru/hitam) & nomor pemain (1-10)."""

  def __init__(
      self,
      plat_weights="plat_best.pt",
      digit_weights="digit_best.pt",
      imgsz=640,
      conf=0.45,
      min_digit_conf=0.45,
      min_size_ratio=0.055,
      history_len=6,
      min_hits=3,
  ):
    self.model_plat = YOLO(plat_weights)
    self.model_digit = YOLO(digit_weights)
    self.imgsz = imgsz
    self.conf = conf
    self.min_digit_conf = min_digit_conf
    self.min_size_ratio = min_size_ratio
    self.history_len = history_len
    self.min_hits = min_hits
    self.tracks = {}
    self.next_id = 0

  @staticmethod
  def _has_white_paper(crop):
    """Memastikan area plat memiliki latar kertas putih (aman di indoor redup maupun outdoor)."""
    hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
    white_mask = (hsv[:, :, 1] < 85) & (hsv[:, :, 2] > 95)
    return float(white_mask.mean()) >= 0.15

  def _stabilize(self, detections):
    used_ids = set()
    stabilized = []

    for det in detections:
      x1, y1, x2, y2 = det["bbox"]
      cx, cy = (x1 + x2) / 2.0, (y1 + y2) / 2.0

      best_id = None
      best_dist = 90.0
      for tid, tr in self.tracks.items():
        if tid in used_ids:
          continue
        dist = math.hypot(cx - tr["cx"], cy - tr["cy"])
        if dist < best_dist:
          best_dist = dist
          best_id = tid

      if best_id is None:
        best_id = self.next_id
        self.next_id += 1
        self.tracks[best_id] = {
            "cx": cx,
            "cy": cy,
            "hits": 0,
            "missed": 0,
            "tim_hist": deque(maxlen=self.history_len),
            "num_hist": deque(maxlen=self.history_len),
        }

      used_ids.add(best_id)
      tr = self.tracks[best_id]
      tr["cx"], tr["cy"] = cx, cy
      tr["hits"] += 1
      tr["missed"] = 0
      tr["tim_hist"].append(det["tim"])
      tr["num_hist"].append(det["nomor"])

      if tr["hits"] >= self.min_hits:
        stabilized.append({
            "track_id": best_id,
            "tim": Counter(tr["tim_hist"]).most_common(1)[0][0],
            "nomor": Counter(tr["num_hist"]).most_common(1)[0][0],
            "bbox": det["bbox"],
            "conf_tim": det["conf_tim"],
            "conf_nomor": det["conf_nomor"],
        })

    for tid in list(self.tracks.keys()):
      if tid not in used_ids:
        self.tracks[tid]["missed"] += 1
        if self.tracks[tid]["missed"] > 10:
          del self.tracks[tid]

    return stabilized

  def predict(self, frame, use_stabilizer=True):
    """Menerima 1 frame BGR OpenCV, mengembalikan list dict pemain valid."""
    h, w = frame.shape[:2]
    min_box_px = int(min(w, h) * self.min_size_ratio)
    results = self.model_plat.predict(
        frame, imgsz=self.imgsz, conf=self.conf, verbose=False
    )[0]

    raw_dets = []
    for box in results.boxes:
      x1, y1, x2, y2 = map(int, box.xyxy[0].tolist())
      x1, y1, x2, y2 = max(0, x1), max(0, y1), min(w, x2), min(h, y2)
      bw, bh = x2 - x1, y2 - y1

      if bw < min_box_px or bh < min_box_px:
        continue
      if not (0.5 <= (bw / float(bh)) <= 1.8):
        continue

      crop = frame[y1:y2, x1:x2]
      if not self._has_white_paper(crop):
        continue

      digit_res = self.model_digit.predict(crop, imgsz=64, verbose=False)[0]
      digit_conf = float(digit_res.probs.top1conf)
      if digit_conf < self.min_digit_conf:
        continue

      plat_name = self.model_plat.names[int(box.cls[0].item())]
      plat_conf = float(box.conf[0].item())
      nomor_int = int(self.model_digit.names[int(digit_res.probs.top1)])

      raw_dets.append({
          "tim": plat_name.replace("plat_", ""),
          "nomor": nomor_int,
          "bbox": [x1, y1, x2, y2],
          "conf_tim": round(plat_conf, 2),
          "conf_nomor": round(digit_conf, 2),
      })

    return self._stabilize(raw_dets) if use_stabilizer else raw_dets