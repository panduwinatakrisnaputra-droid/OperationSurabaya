const API_BASE = window.OPS_API_BASE || (window.location.protocol === 'file:' ? 'https://operationsurabaya.pipip.my.id' : window.location.origin);
const WS_BASE = API_BASE.replace(/^http/, "ws");
const RTC_CONFIG = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

const matchIdInput = document.getElementById("matchIdInput");
const slotSelect = document.getElementById("slotSelect");
const facingSelect = document.getElementById("facingSelect");
const btnStart = document.getElementById("btnStart");
const btnFlip = document.getElementById("btnFlip");
const btnStop = document.getElementById("btnStop");
const liveBadge = document.getElementById("liveBadge");
const activeSlotLabel = document.getElementById("activeSlotLabel");
const connText = document.getElementById("connText");
const refereeVideo = document.getElementById("refereeVideo");
const logBox = document.getElementById("logBox");

let localStream = null;
let ws = null;
let pc = null;

function writeLog(message) {
  const now = new Date().toLocaleTimeString("id-ID");
  logBox.innerHTML += `<br>[${now}] ${message}`;
  logBox.scrollTop = logBox.scrollHeight;
  console.log(`[REF-CAM] ${message}`);
}

function getSelectedSlot() {
  const option = slotSelect.options[slotSelect.selectedIndex];
  return {
    id: option.value,
    label: option.dataset.label || option.textContent.toUpperCase(),
  };
}

function setStatus(isLive, text) {
  liveBadge.textContent = isLive ? "LIVE" : "OFFLINE";
  liveBadge.classList.toggle("live", isLive);
  connText.textContent = text;
}

async function openCamera(facingMode) {
  if (localStream) {
    localStream.getTracks().forEach((track) => track.stop());
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: facingMode }, width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  });
  localStream = stream;
  refereeVideo.srcObject = stream;
  return stream;
}

async function sendOffer() {
  if (!localStream || !ws || ws.readyState !== WebSocket.OPEN) return;
  if (pc) {
    pc.close();
  }

  pc = new RTCPeerConnection(RTC_CONFIG);
  localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));

  pc.onicecandidate = (event) => {
    if (event.candidate && ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "ice-candidate", candidate: event.candidate }));
    }
  };

  pc.onconnectionstatechange = () => {
    const state = pc.connectionState;
    writeLog(`WebRTC state: ${state}`);
    if (state === "connected") {
      setStatus(true, "Terhubung ke Admin Dashboard");
    } else if (state === "disconnected" || state === "failed") {
      setStatus(false, "Koneksi video terputus");
    }
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  ws.send(JSON.stringify({ type: "offer", sdp: pc.localDescription }));
  writeLog("Offer video dikirim ke Command Center.");
}

async function startLive() {
  stopLive(false);
  const matchId = (matchIdInput.value || "default").trim();
  const slot = getSelectedSlot();
  activeSlotLabel.textContent = slot.label;

  try {
    await openCamera(facingSelect.value);
    writeLog(`Kamera aktif untuk ${slot.label}`);

    const wsUrl = `${WS_BASE}/ws/referee-cam/${encodeURIComponent(matchId)}/${encodeURIComponent(slot.id)}?role=referee`;
    ws = new WebSocket(wsUrl);

    ws.onopen = async () => {
      setStatus(true, "Menunggu Admin menekan CONFIRM...");
      writeLog(`Terhubung ke channel ${matchId}/${slot.id}`);
      await sendOffer();
    };

    ws.onmessage = async (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === "answer" && pc) {
        await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
        setStatus(true, "LIVE di Admin Dashboard");
        writeLog("Admin Dashboard menerima stream.");
      } else if (msg.type === "ice-candidate" && msg.candidate && pc) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
        } catch (err) {
          console.warn("ICE error:", err);
        }
      } else if (msg.type === "admin-ready") {
        writeLog("Admin memilih slot ini, mengirim ulang stream...");
        await sendOffer();
      }
    };

    ws.onclose = () => {
      setStatus(false, "Koneksi server ditutup");
      writeLog("WebSocket ditutup.");
    };
  } catch (err) {
    setStatus(false, "Gagal membuka kamera");
    writeLog(`Error: ${err.message}`);
  }
}

async function flipCamera() {
  facingSelect.value = facingSelect.value === "environment" ? "user" : "environment";
  if (localStream) {
    await openCamera(facingSelect.value);
    await sendOffer();
    writeLog(`Kamera diganti ke mode: ${facingSelect.value}`);
  }
}

function stopLive(shouldLog = true) {
  if (pc) {
    pc.close();
    pc = null;
  }
  if (ws) {
    ws.close();
    ws = null;
  }
  if (localStream) {
    localStream.getTracks().forEach((track) => track.stop());
    localStream = null;
  }
  refereeVideo.srcObject = null;
  setStatus(false, "Stream dihentikan");
  if (shouldLog) writeLog("Stream kamera wasit dihentikan.");
}

slotSelect.addEventListener("change", () => {
  activeSlotLabel.textContent = getSelectedSlot().label;
});
btnStart.addEventListener("click", startLive);
btnFlip.addEventListener("click", flipCamera);
btnStop.addEventListener("click", () => stopLive(true));