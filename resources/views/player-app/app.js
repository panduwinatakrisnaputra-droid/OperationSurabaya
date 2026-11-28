// ==========================================
// OPERATION: SURABAYA
// PLAYER PORTAL - APP.JS (SYNCED COMMS + YOLO WEAPON & PLATE LOOP + CROSSHAIR)
// ==========================================

const API_BASE = window.OPS_API_BASE || (window.location.protocol === 'file:' ? 'https://operationsurabaya.pipip.my.id' : window.location.origin);
window.OPS_API_BASE = API_BASE;

const $ = (id) => document.getElementById(id);

let player = null;
let match = null;
let roomsCache = [];
let pollHandle = null;
let accessToken = localStorage.getItem('access_token') || sessionStorage.getItem('access_token');

let cameraStream = null;
let gameplayOpened = false;
let healthPollHandle = null;
let playerEliminated = false;
let shootCooldown = false;
let timerTickHandle = null;
let timerSyncHandle = null;

// Weapon & Target Detection State
let gunDetectHandle = null;
let gunDetectInFlight = false;
let latestGunDetection = {
  detected: false,
  on_target: false,
  confidence: 0,
  box: null,
  plat: null,
  relation: 'unknown',
  can_shoot: false,
  updatedAt: 0
};
let latestMatchPlayers = [];

// QR & Tactical Objective State
let weaponQrScanner = null;
let weaponQrBusy = false;
let weaponQrRestartGameplayCamera = false;
let ghostQrScanner = null;
let ghostQrBusy = false;
let ghostQrRestartGameplayCamera = false;
let ghostModeUntil = null;
let ghostModeTickHandle = null;


// [TAMBAHAN GPS]
let gpsWatchId = null;
let gpsSendTimer = null;
let latestGpsCoords = null;

// ==========================================
// API CONFIGURATION & STATE BROADCASTER
// ==========================================

async function api(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    ...(options.headers || {})
  };

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers
  });

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(body.detail || body.message || `HTTP ${response.status}`);
  }

  return body;
}

function saveToken(token) {
  accessToken = token || null;

  if (accessToken) {
    localStorage.setItem('access_token', accessToken);
    sessionStorage.removeItem('access_token');
  } else {
    localStorage.removeItem('access_token');
    sessionStorage.removeItem('access_token');
    localStorage.removeItem('player_portal_context');
    broadcastPlayerPortalSync('logged_out');
  }
}

// Sinkronkan state player-app ke localStorage & Tactical Comms secara real-time
function broadcastPlayerPortalSync(reason = 'state_update') {
  const context = accessToken && player ? {
    player,
    match: match || null,
    teamCode: window.currentPlayerTeam || null,
    view: gameplayOpened ? 'gameplay' : match ? 'lobby' : 'rooms',
    matchStatus: match?.status || null,
    players: latestMatchPlayers,
    savedAt: Date.now()
  } : null;

  if (context) {
    localStorage.setItem('player_portal_context', JSON.stringify(context));
  }

  window.dispatchEvent(new CustomEvent('ops-player-state-sync', {
    detail: { reason, context }
  }));
}

function persistPortalContext(view = null) {
  if (!accessToken || !player) return;
  const context = {
    player,
    match: match || null,
    teamCode: window.currentPlayerTeam || null,
    view: view || (gameplayOpened ? 'gameplay' : match ? 'lobby' : 'rooms'),
    matchStatus: match?.status || null,
    players: latestMatchPlayers,
    savedAt: Date.now()
  };
  localStorage.setItem('player_portal_context', JSON.stringify(context));
  window.dispatchEvent(new CustomEvent('ops-player-state-sync', {
    detail: { reason: 'persist', context }
  }));
}

async function restorePortalSession() {
  if (!accessToken) return;
  let context = null;
  try {
    context = JSON.parse(localStorage.getItem('player_portal_context') || 'null');
  } catch (_) {}

  if (!context || !context.player || !context.player.id) {
    saveToken(null);
    return;
  }

  player = context.player;
  match = context.match || null;
  window.currentPlayerTeam = context.teamCode || null;
  latestMatchPlayers = Array.isArray(context.players) ? context.players : [];

  $('loginPanel').classList.add('hidden');
  $('teamPanel').classList.add('hidden');
  $('lobbyPanel').classList.add('hidden');
  $('gameplayPanel').classList.add('hidden');
  document.body.classList.remove('in-gameplay');

  if (match && match.id && context.teamCode) {
    $('roomPanel').classList.add('hidden');
    $('lobbyPanel').classList.remove('hidden');
    $('lobbyWelcome').textContent = `${player.player_number ? `#${player.player_number} · ` : ''}${player.full_name} (@${player.username})`;
    $('operationStatus').textContent = 'LOBBY';
    persistPortalContext('lobby');

    await refreshLobby();
    if (match && !gameplayOpened) {
      if (pollHandle) clearInterval(pollHandle);
      pollHandle = setInterval(refreshLobby, 3000);
    }
    return;
  }

  match = null;
  window.currentPlayerTeam = null;
  await continueToTeam(player);
}

function getPlayer(result) {
  if (result.player) return result.player;
  if (Array.isArray(result.data)) return result.data[0];
  if (result.data) return result.data;
  return null;
}

// ==========================================
// HINT MESSAGE
// ==========================================

function setHint(id, message, isError = false) {
  const element = $(id);
  if (!element) return;
  element.textContent = message;
  element.style.color = isError ? '#ff858a' : '';
}

// ==========================================
// CAMERA MANAGEMENT & FRAME CAPTURE
// ==========================================

function stopGameplayCamera() {
  stopGunDetectionLoop();
  if (cameraStream) {
    cameraStream.getTracks().forEach(track => track.stop());
    cameraStream = null;
  }

  const video = $('gameplayCamera');
  if (video) {
    video.srcObject = null;
  }
}

function captureGameplayFrameBase64(quality = 0.72, maxWidth = 640) {
  const video = $('gameplayCamera');
  if (!video || !cameraStream || video.paused || video.ended || video.videoWidth === 0) {
    return null;
  }

  const scale = Math.min(1, maxWidth / video.videoWidth);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
  canvas.height = Math.max(1, Math.round(video.videoHeight * scale));

  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', quality);
}

async function startGameplayCamera() {
  const video = $('gameplayCamera');
  const placeholder = $('cameraPlaceholder');
  const message = $('cameraMessage');
  const status = $('cameraStatus');

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    if (message) {
      message.textContent = 'Browser tidak mendukung kamera atau halaman belum menggunakan HTTPS/localhost.';
    }
    if (status) status.textContent = 'CAMERA UNAVAILABLE';
    return;
  }

  try {
    if (status) status.textContent = 'REQUESTING CAMERA...';
    if (message) message.textContent = 'Meminta izin akses kamera...';

    stopGameplayCamera();
    stopAuthCamera(); // kamera login wajah harus dilepas dulu, HP biasanya hanya bisa buka 1 kamera

    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      });
    } catch (firstError) {
      if (firstError.name === 'NotAllowedError' || firstError.name === 'PermissionDeniedError' || firstError.name === 'NotFoundError') throw firstError;
      // Beri jeda singkat agar kamera sebelumnya benar-benar lepas, lalu coba lagi dengan constraint paling longgar
      await new Promise((resolve) => setTimeout(resolve, 400));
      cameraStream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
    }

    if (video) {
      video.srcObject = cameraStream;
      await video.play();
    }

    if (placeholder) placeholder.classList.add('hidden');
    if (status) status.textContent = 'CAMERA CONNECTED';
    if (message) message.textContent = 'Kamera berhasil diaktifkan.';

    startGunDetectionLoop();
  } catch (error) {
    console.error('Kamera gagal diaktifkan:', error);
    if (placeholder) placeholder.classList.remove('hidden');
    if (status) status.textContent = 'CAMERA ERROR';

    if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
      if (message) message.textContent = 'Izin kamera ditolak. Izinkan akses kamera melalui pengaturan browser.';
    } else if (error.name === 'NotFoundError') {
      if (message) message.textContent = 'Kamera tidak ditemukan pada perangkat ini.';
    } else if (error.name === 'NotReadableError' || error.name === 'AbortError') {
      if (message) message.textContent = 'Kamera sedang dipakai aplikasi/tab lain. Tutup tab lain yang memakai kamera, lalu tekan Aktifkan Kamera.';
    } else {
      if (message) message.textContent = 'Kamera gagal diaktifkan (' + (error.name || 'Error') + '). Pastikan halaman menggunakan HTTPS atau localhost.';
    }
    updateShootButtonReadiness();
  }
}

// ==========================================
// YOLOv4-TINY WEAPON & YOLO11 PLATE DETECTION
// ==========================================

function syncEnemyTargets(playersList = []) {
  const select = $('targetSelect');
  if (!select || !player) return;

  const myTeam = String(window.currentPlayerTeam || '').toUpperCase();
  const previousValue = select.value;

  const enemies = (playersList || []).filter((p) => {
    if (!p || p.player_id === player.id) return false;
    if (p.is_eliminated || (p.current_health !== null && Number(p.current_health) <= 0)) return false;
    const targetTeam = String(p.team_code || '').toUpperCase();
    return myTeam && targetTeam && targetTeam !== myTeam;
  });

  select.innerHTML = '';

  if (!enemies.length) {
    const emptyOpt = document.createElement('option');
    emptyOpt.value = '';
    emptyOpt.textContent = 'TARGET: TIDAK ADA MUSUH AKTIF';
    select.appendChild(emptyOpt);
    updateShootButtonReadiness();
    return;
  }

  enemies.forEach((enemy) => {
    const opt = document.createElement('option');
    opt.value = enemy.player_id;
    const numTag = enemy.player_number ? `#${enemy.player_number} ` : '';
    const name = enemy.full_name || enemy.username || 'ENEMY';
    const hp = enemy.current_health ?? 100;
    opt.textContent = `${numTag}${name} [${enemy.team_code}] (${hp} HP)`;
    select.appendChild(opt);
  });

  if (enemies.some((e) => String(e.player_id) === String(previousValue))) {
    select.value = previousValue;
  } else {
    select.value = enemies[0].player_id;
  }

  updateShootButtonReadiness();
}

function getOrCreatePlateBox() {
  const gunBox = $('gunBox');
  if (!gunBox || !gunBox.parentElement) return { plateBox: null, plateLabel: null };
  let plateBox = $('plateBox');
  if (!plateBox) {
    plateBox = gunBox.cloneNode(true);
    plateBox.id = 'plateBox';
    const lbl = plateBox.querySelector('#gunBoxLabel');
    if (lbl) lbl.id = 'plateBoxLabel';
    gunBox.parentElement.appendChild(plateBox);
  }
  return { plateBox, plateLabel: $('plateBoxLabel') };
}

function renderGunDetectionOverlay(detection) {
  const boxEl = $('gunBox');
  const labelEl = $('gunBoxLabel');
  const statusEl = $('gunStatus');
  const crosshairEl = $('crosshair');
  const { plateBox, plateLabel } = getOrCreatePlateBox();

  const targetPlate = detection?.plat?.target_plate || null;
  const relation = detection?.relation || 'unknown';
  const gunDetected = Boolean(detection && detection.detected && detection.box);
  const isTeammate = relation === 'teammate';
  const isReadyToFire = Boolean(gunDetected && targetPlate && !isTeammate);

  if (targetPlate && !isTeammate && $('targetSelect')) {
    const matchedEnemy = (latestMatchPlayers || []).find(
      (p) =>
        String(p.team_code || '').toUpperCase() === String(targetPlate.team_code || '').toUpperCase() &&
        Number(p.player_number) === Number(targetPlate.nomor) &&
        !p.is_eliminated &&
        Number(p.current_health ?? 100) > 0
    );
    if (matchedEnemy) {
      $('targetSelect').value = matchedEnemy.player_id;
    }
  }

  if (crosshairEl) {
    crosshairEl.classList.toggle('on-target', isReadyToFire || gunDetected);
  }

  // 1. Gambar kotak khusus PISTOL
  if (boxEl) {
    if (gunDetected) {
      const { x, y, w, h } = detection.box;
      const confPct = Math.round((Number(detection.confidence) || 0) * 100);
      boxEl.classList.remove('hidden');
      boxEl.classList.toggle('on-target', true);
      boxEl.style.left = `${Math.max(0, Math.min(100, x * 100))}%`;
      boxEl.style.top = `${Math.max(0, Math.min(100, y * 100))}%`;
      boxEl.style.width = `${Math.max(2, Math.min(100, w * 100))}%`;
      boxEl.style.height = `${Math.max(2, Math.min(100, h * 100))}%`;
      boxEl.style.borderColor = '#00ff88';
      if (labelEl) labelEl.textContent = `GUN (${confPct}%)`;
    } else {
      boxEl.classList.add('hidden');
    }
  }

  // 2. Gambar kotak kedua khusus PLAT TIM & NOMOR
  if (plateBox) {
    if (targetPlate && targetPlate.box) {
      const { x, y, w, h } = targetPlate.box;
      const plateColor = isTeammate ? '#3b82f6' : isReadyToFire ? '#00ff88' : '#facc15';
      plateBox.classList.remove('hidden');
      plateBox.classList.toggle('on-target', isReadyToFire);
      plateBox.style.left = `${Math.max(0, Math.min(100, x * 100))}%`;
      plateBox.style.top = `${Math.max(0, Math.min(100, y * 100))}%`;
      plateBox.style.width = `${Math.max(2, Math.min(100, w * 100))}%`;
      plateBox.style.height = `${Math.max(2, Math.min(100, h * 100))}%`;
      plateBox.style.borderColor = plateColor;
      if (plateLabel) {
        const roleTag = isTeammate ? 'TEMAN' : 'ENEMY';
        plateLabel.textContent = `${roleTag}: ${targetPlate.team_code} #${targetPlate.nomor}`;
      }
    } else {
      plateBox.classList.add('hidden');
    }
  }

  if (statusEl) {
    statusEl.classList.toggle('locked', isReadyToFire);
    if (!gunDetected && !targetPlate) {
      statusEl.textContent = cameraStream ? 'SCANNING WEAPON & PLATE...' : 'CAMERA OFF';
      statusEl.style.color = '#94a3b8';
    } else if (isTeammate) {
      statusEl.textContent = `TEMAN (${targetPlate.team_code} #${targetPlate.nomor}) · DILARANG TEMBAK`;
      statusEl.style.color = '#3b82f6';
    } else if (isReadyToFire) {
      statusEl.textContent = `ENEMY (${targetPlate.team_code} #${targetPlate.nomor}) · SIAP TEMBAK`;
      statusEl.style.color = '#00ff88';
    } else if (targetPlate) {
      statusEl.textContent = `ENEMY (${targetPlate.team_code} #${targetPlate.nomor}) · ARAHKAN PISTOL KE KAMERA`;
      statusEl.style.color = '#facc15';
    } else {
      statusEl.textContent = 'PISTOL TERDETEKSI · ARAHKAN KE PLAT MUSUH';
      statusEl.style.color = '#00ff88';
    }
  }
}

function updateShootButtonReadiness() {
  const button = $('shootBtn');
  if (!button) return;

  if (playerEliminated || match?.status === 'completed') {
    button.disabled = true;
    button.classList.remove('ready-to-fire');
    return;
  }

  if (shootCooldown) return;

  const hasTarget = Boolean($('targetSelect')?.value);
  const isFresh = (Date.now() - latestGunDetection.updatedAt) < 4000;
  const targetPlate = latestGunDetection.plat?.target_plate || null;
  const isTeammate = latestGunDetection.relation === 'teammate';
  const hasWeapon = Boolean(latestGunDetection.detected);

  const canFire = Boolean(
    cameraStream &&
    hasTarget &&
    isFresh &&
    hasWeapon &&
    targetPlate &&
    !isTeammate
  );

  button.disabled = !canFire;
  button.classList.toggle('ready-to-fire', canFire);
  button.classList.toggle('no-target', !canFire);

  const label = button.querySelector('.shoot-label');
  if (label && !label.textContent.startsWith('SHOT')) {
    if (!cameraStream) {
      label.textContent = 'NO CAM';
    } else if (!isFresh) {
      label.textContent = 'SCANNING';
    } else if (isTeammate) {
      label.textContent = 'TEAMMATE';
    } else if (!hasWeapon) {
      label.textContent = 'NO GUN';
    } else if (!targetPlate || !hasTarget) {
      label.textContent = 'NO PLATE';
    } else {
      label.textContent = 'FIRE';
    }
  }
}

let lastSolidGun = { box: null, confidence: 0, at: 0 };
let lastSolidPlate = { target_plate: null, relation: 'unknown', at: 0 };

async function runSingleGunDetectionTick() {
  if (!gameplayOpened || !player || !match || playerEliminated || match.status === 'completed') return;
  if (gunDetectInFlight || !cameraStream) return;

  const frameBase64 = captureGameplayFrameBase64(0.78, 640);
  if (!frameBase64) return;

  gunDetectInFlight = true;
  try {
    const res = await api(`/api/matches/${match.id}/detect-gun`, {
      method: 'POST',
      body: JSON.stringify({
        image: frameBase64,
        player_id: player.id
      })
    });

    const now = Date.now();
    if (res.detected && res.box) {
      lastSolidGun = { box: res.box, confidence: Number(res.confidence || 0), at: now };
    }
    const rawPlate = res.plat?.target_plate || null;
    if (rawPlate) {
      lastSolidPlate = { target_plate: rawPlate, relation: res.relation || 'unknown', at: now };
    }

    // Pertahankan kotak selama 1.2 detik jika 1-2 frame sempat berkedip
    const keepGun = res.detected || (now - lastSolidGun.at < 3500 && lastSolidGun.box);
    const keepPlate = rawPlate || (now - lastSolidPlate.at < 3500 ? lastSolidPlate.target_plate : null);

    latestGunDetection = {
      detected: Boolean(keepGun),
      on_target: Boolean(keepGun),
      confidence: res.detected ? Number(res.confidence || 0) : lastSolidGun.confidence,
      box: res.detected ? res.box : (keepGun ? lastSolidGun.box : null),
      plat: { ...(res.plat || {}), target_plate: keepPlate },
      relation: rawPlate ? (res.relation || 'unknown') : (keepPlate ? lastSolidPlate.relation : 'unknown'),
      can_shoot: Boolean(keepGun && keepPlate && (rawPlate ? res.relation : lastSolidPlate.relation) !== 'teammate'),
      updatedAt: now
    };

    renderGunDetectionOverlay(latestGunDetection);
  } catch (err) {
    latestGunDetection = {
      detected: false,
      on_target: false,
      confidence: 0,
      box: null,
      plat: null,
      relation: 'unknown',
      can_shoot: false,
      updatedAt: 0
    };
    renderGunDetectionOverlay(null);
    if ($('gunStatus')) {
      $('gunStatus').textContent = 'DETECTOR STANDBY';
    }
  } finally {
    gunDetectInFlight = false;
    updateShootButtonReadiness();
  }
}

function startGunDetectionLoop() {
  stopGunDetectionLoop();
  latestGunDetection = {
    detected: false,
    on_target: false,
    confidence: 0,
    box: null,
    plat: null,
    relation: 'unknown',
    can_shoot: false,
    updatedAt: 0
  };
  updateShootButtonReadiness();
  gunDetectHandle = setInterval(runSingleGunDetectionTick, 150);
}

function stopGunDetectionLoop() {
  if (gunDetectHandle) {
    clearInterval(gunDetectHandle);
    gunDetectHandle = null;
  }
  gunDetectInFlight = false;
  latestGunDetection = {
    detected: false,
    on_target: false,
    confidence: 0,
    box: null,
    plat: null,
    relation: 'unknown',
    can_shoot: false,
    updatedAt: 0
  };
  renderGunDetectionOverlay(null);
  updateShootButtonReadiness();
}

// ==========================================
// GAMEPLAY SCREEN
// ==========================================

// ==========================================
// GAMEPLAY GPS LOCATION TRACKING [TAMBAHAN GPS]
// ==========================================

function setGpsBadge(text, confirmed = false) {
  const badge = $('gpsStatus');
  if (!badge) return;
  badge.textContent = text;
  badge.style.color = confirmed ? '#00ff88' : '';
  badge.style.borderColor = confirmed ? 'rgba(0, 255, 136, 0.45)' : '';
}

async function sendCurrentGpsLocation() {
  if (!player || !match || !gameplayOpened || !latestGpsCoords) return;

  try {
    const res = await api(`/api/matches/${match.id}/movement`, {
      method: 'POST',
      body: JSON.stringify({
        player_id: player.id,
        latitude: latestGpsCoords.latitude,
        longitude: latestGpsCoords.longitude
      })
    });
    setGpsBadge('GPS CONFIRMED', true);
    console.log('[GPS] Terkirim:', res);
  } catch (error) {
    setGpsBadge('GPS SYNC ERROR', false);
    console.warn('[GPS] Gagal mengirim lokasi:', error.message);
  }
}

function startGameplayGpsTracking() {
  stopGameplayGpsTracking();

  if (!('geolocation' in navigator)) {
    setGpsBadge('GPS UNSUPPORTED', false);
    console.warn('[GPS] Geolocation tidak didukung pada browser ini.');
    return;
  }

  setGpsBadge('LOCATING GPS...', false);
  console.log('[GPS] Memulai pelacakan lokasi pemain...');

  gpsWatchId = navigator.geolocation.watchPosition(
    (position) => {
      const isFirstFix = !latestGpsCoords;
      latestGpsCoords = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude
      };
      if (isFirstFix) {
        sendCurrentGpsLocation();
      }
    },
    (error) => {
      setGpsBadge('GPS BLOCKED / ERROR', false);
      console.warn('[GPS] Tracking error:', error.message);
    },
    {
      enableHighAccuracy: true,
      maximumAge: 2000,
      timeout: 10000
    }
  );

  gpsSendTimer = setInterval(sendCurrentGpsLocation, 3000);
}

function stopGameplayGpsTracking() {
  if (gpsWatchId !== null && 'geolocation' in navigator) {
    navigator.geolocation.clearWatch(gpsWatchId);
    gpsWatchId = null;
  }
  if (gpsSendTimer) {
    clearInterval(gpsSendTimer);
    gpsSendTimer = null;
  }
  latestGpsCoords = null;
  setGpsBadge('GPS STANDBY', false);
}
function openGameplay() {
  if (gameplayOpened) return;

  gameplayOpened = true;
  if (match) match.status = 'active';
  document.body.classList.add('in-gameplay');
  persistPortalContext('gameplay');

  if (pollHandle) {
    clearInterval(pollHandle);
    pollHandle = null;
  }

  $('loginPanel').classList.add('hidden');
  $('teamPanel').classList.add('hidden');
  $('lobbyPanel').classList.add('hidden');
  $('gameplayPanel').classList.remove('hidden');

  $('operationStatus').textContent = 'ACTIVE';
  $('gameplayStatus').textContent = 'ACTIVE';
  startBaseShutdownNotificationPolling();

  $('gameplayMatchName').textContent = match?.match_name || 'OPERATION: SURABAYA';
  $('gameplayPlayerInfo').textContent = `${player?.full_name || 'PLAYER'} · ${
    player?.username ? '@' + player.username : ''
  }`;

  const teamName = window.currentPlayerTeam || 'TEAM';
  $('gameplayTeamBadge').textContent = teamName;
  $('gameplayTeamBadge').className = `team-badge ${teamName.toLowerCase()}`;
  $('gameplayTeamBadge').style.color = teamColor(teamName);

  startGameplayCamera();
  startGameplayGpsTracking();
  startGameplayHealthPolling();
  startGameplayTimer();
  refreshGameplayWeapon();
}

// ==========================================
// AUTHENTICATION UI
// ==========================================

function showAuth(mode) {
  const isLogin = mode === 'login';
  $('loginFields').classList.toggle('hidden', !isLogin);
  $('registerFields').classList.toggle('hidden', isLogin);
  $('showLogin').classList.toggle('active', isLogin);
  $('showRegister').classList.toggle('active', !isLogin);
  $('authTitle').textContent = isLogin ? 'Player login' : 'Create player account';
}

$('showLogin').addEventListener('click', () => showAuth('login'));
$('showRegister').addEventListener('click', () => showAuth('register'));

// ==========================================
// CONTINUE AFTER LOGIN
// ==========================================

async function continueToTeam(profile) {
  if (!profile) throw new Error('Profil pemain tidak ditemukan dari respons backend.');
  player = profile;
  match = null;
  window.currentPlayerTeam = null;
  latestMatchPlayers = [];
  document.body.classList.remove('in-gameplay');
  persistPortalContext('rooms');

  $('loginPanel').classList.add('hidden');
  $('teamPanel').classList.add('hidden');
  $('lobbyPanel').classList.add('hidden');
  $('roomPanel').classList.remove('hidden');
  $('roomWelcome').textContent = `Logged in as ${player.full_name} (@${player.username})`;
  $('roomPlayerName').textContent = `${player.player_number ? `#${player.player_number} · ` : ''}${player.username || player.full_name}`;
  $('operationStatus').textContent = 'ROOM BROWSER';
  await loadRooms();
}

// ==========================================
// ROOM BROWSER / CREATE / JOIN
// ==========================================

function showRoomHint(id, message, isError = false) {
  setHint(id, message, isError);
}

async function loadRooms(search = '') {
  const container = $('roomList');
  container.innerHTML = '<p class="hint">Memuat daftar room...</p>';
  try {
    const query = new URLSearchParams({ status: 'waiting', page: '1', page_size: '50' });
    if (search) query.set('search', search);
    const result = await api(`/api/rooms?${query.toString()}`);
    roomsCache = result.data || [];
    renderRooms(roomsCache);
    $('roomListHint').textContent = `${result.total_rooms || roomsCache.length} room tersedia.`;
  } catch (error) {
    container.innerHTML = '<p class="hint">Daftar room gagal dimuat.</p>';
    showRoomHint('roomListHint', error.message, true);
  }
}

const TEAM_CATALOG = [
  { code: 'RED', color: '#EF4444' },
  { code: 'BLUE', color: '#3B82F6' },
  { code: 'GREEN', color: '#22C55E' },
  { code: 'YELLOW', color: '#EAB308' }
];
let createTeamCount = 2;

function teamColor(code) {
  return TEAM_CATALOG.find(t => t.code === code)?.color || '#64748B';
}

function renderCreateTeamEditor() {
  const root = $('createTeamEditor');
  if (!root) return;
  root.innerHTML = '';
  TEAM_CATALOG.slice(0, createTeamCount).forEach((team, index) => {
    const row = document.createElement('div');
    row.className = 'dynamic-team-row';
    const swatch = document.createElement('span');
    swatch.className = 'dynamic-team-swatch';
    swatch.style.background = team.color;
    const name = document.createElement('strong');
    name.textContent = `${team.code} TEAM`;
    const capacityWrap = document.createElement('div');
    const label = document.createElement('label');
    label.textContent = 'KAPASITAS';
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '1';
    input.max = '50';
    input.value = '5';
    input.dataset.teamCode = team.code;
    input.className = 'team-capacity-input';
    capacityWrap.append(label, input);
    row.append(swatch, name, capacityWrap);

    if (index === createTeamCount - 1 && index >= 2) {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'btn outline';
      remove.textContent = '×';
      remove.title = 'Hapus tim';
      remove.addEventListener('click', () => {
        createTeamCount--;
        renderCreateTeamEditor();
      });
      row.append(remove);
    }
    root.appendChild(row);
  });

  const add = $('addTeamBtn');
  if (add) add.disabled = createTeamCount >= TEAM_CATALOG.length;

  const host = $('hostTeam');
  const previous = host.value;
  host.innerHTML = '';
  TEAM_CATALOG.slice(0, createTeamCount).forEach(t => {
    const o = document.createElement('option');
    o.value = t.code;
    o.textContent = `${t.code} TEAM`;
    host.append(o);
  });
  host.value = TEAM_CATALOG.slice(0, createTeamCount).some(t => t.code === previous) ? previous : 'RED';
}

$('addTeamBtn')?.addEventListener('click', () => {
  if (createTeamCount < TEAM_CATALOG.length) {
    createTeamCount++;
    renderCreateTeamEditor();
  }
});
renderCreateTeamEditor();

function renderRooms(rooms) {
  const container = $('roomList');
  container.innerHTML = '';
  if (!rooms.length) {
    container.innerHTML = '<p class="hint">Belum ada room yang tersedia. Kamu bisa membuat room baru atau bergabung menggunakan kode.</p>';
    return;
  }
  rooms.forEach(room => {
    const card = document.createElement('article');
    card.className = 'room-card';
    const title = document.createElement('div');
    title.className = 'room-card-title';
    const name = document.createElement('h4');
    name.textContent = room.match_name || 'Untitled Room';
    const code = document.createElement('span');
    code.className = 'room-code';
    code.textContent = room.room_code || 'NO CODE';
    title.append(name, code);

    const meta = document.createElement('p');
    meta.textContent = `${room.arena_name || 'Arena'} · ${String(room.status || '').toUpperCase()}`;

    const teams = document.createElement('div');
    teams.className = 'room-team-capacity';
    (room.teams || []).forEach(t => {
      const item = document.createElement('span');
      item.style.setProperty('--team-color', t.team_color || teamColor(t.team_code));
      item.textContent = `${t.team_name} ${t.total}/${t.capacity}`;
      teams.append(item);
    });

    const controls = document.createElement('div');
    controls.className = 'room-card-controls';
    const select = document.createElement('select');
    (room.teams || []).forEach(t => {
      const option = document.createElement('option');
      option.value = t.team_code;
      option.textContent = `${t.team_name} · ${t.total}/${t.capacity}${t.available <= 0 ? ' · FULL' : ''}`;
      option.disabled = t.available <= 0;
      select.append(option);
    });
    const join = document.createElement('button');
    join.type = 'button';
    join.className = 'btn primary';
    join.textContent = 'JOIN';
    join.disabled = !(room.teams || []).some(t => t.available > 0);
    join.addEventListener('click', () => joinRoom(room.room_code, select.value));
    controls.append(select, join);
    card.append(title, meta, teams, controls);
    container.appendChild(card);
  });
}

function enterLobby(room, teamCode) {
  match = { ...room };
  window.currentPlayerTeam = teamCode;
  document.body.classList.remove('in-gameplay');
  persistPortalContext('lobby');

  $('lobbyRoomCode').textContent = room.room_code || 'ROOM CODE UNAVAILABLE';
  $('assignment').textContent = `${teamCode} TEAM`;
  $('assignment').className = 'assignment';
  $('assignment').style.borderColor = teamColor(teamCode);
  $('assignment').style.color = teamColor(teamCode);
  $('lobbyWelcome').textContent = `${player.player_number ? `#${player.player_number} · ` : ''}${player.full_name} (@${player.username})`;

  $('roomPanel').classList.add('hidden');
  $('teamPanel').classList.add('hidden');
  $('lobbyPanel').classList.remove('hidden');
  $('operationStatus').textContent = 'LOBBY';

  refreshLobby();
  if (pollHandle) clearInterval(pollHandle);
  pollHandle = setInterval(refreshLobby, 3000);
}

async function joinRoom(roomCode, teamCode) {
  if (!player) return;
  const button = $('joinRoomBtn');
  if (button) button.disabled = true;
  showRoomHint('joinRoomHint', 'Menghubungkan ke room...');
  try {
    const result = await api('/api/rooms/join', {
      method: 'POST',
      body: JSON.stringify({
        room_code: roomCode.trim().toUpperCase(),
        player_id: player.id,
        team_code: teamCode
      })
    });
    const refreshed = await api(`/api/rooms?status=waiting&search=${encodeURIComponent(roomCode.trim().toUpperCase())}&page=1&page_size=10`);
    const room = (refreshed.data || []).find(item => item.room_code === roomCode.trim().toUpperCase());
    if (!room) throw new Error('Berhasil join, tetapi data room tidak ditemukan. Refresh Room Browser.');
    showRoomHint('joinRoomHint', result.message || 'Berhasil bergabung.');
    enterLobby(room, teamCode);
  } catch (error) {
    showRoomHint('joinRoomHint', error.message, true);
  } finally {
    if (button) button.disabled = false;
  }
}

$('createRoomBtn').addEventListener('click', async () => {
  if (!player) return;
  const teams = Array.from(document.querySelectorAll('.team-capacity-input')).map(input => ({
    team_code: input.dataset.teamCode,
    capacity: Number(input.value)
  }));
  const payload = {
    match_name: $('createRoomName').value.trim(),
    host_player_id: player.id,
    team_code: $('hostTeam').value,
    teams,
    arena_name: $('roomArena').value.trim()
  };
  if (!payload.match_name || !payload.arena_name) {
    showRoomHint('createRoomHint', 'Nama room dan arena wajib diisi.', true);
    return;
  }
  if (teams.length < 2 || teams.some(t => !Number.isInteger(t.capacity) || t.capacity < 1 || t.capacity > 50)) {
    showRoomHint('createRoomHint', 'Kapasitas setiap tim harus antara 1–50 pemain.', true);
    return;
  }
  if (teams.find(t => t.team_code === payload.team_code).capacity < 1) {
    showRoomHint('createRoomHint', 'Kapasitas tim Host tidak valid.', true);
    return;
  }

  const button = $('createRoomBtn');
  button.disabled = true;
  showRoomHint('createRoomHint', 'Membuat room...');
  try {
    const result = await api('/api/rooms/create', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    showRoomHint('createRoomHint', `Room dibuat. Kode: ${result.room.room_code}`);
    enterLobby(result.room, payload.team_code);
  } catch (error) {
    showRoomHint('createRoomHint', error.message, true);
  } finally {
    button.disabled = false;
  }
});

async function loadJoinTeamsForCode() {
  const code = $('joinRoomCode').value.trim().toUpperCase();
  if (!/^[A-Z0-9]{8}$/.test(code)) return;
  try {
    const result = await api(`/api/rooms?status=waiting&search=${encodeURIComponent(code)}&page=1&page_size=5`);
    const room = (result.data || []).find(item => item.room_code === code);
    if (!room) return;
    const select = $('joinTeam');
    select.innerHTML = '';
    (room.teams || []).forEach(team => {
      const option = document.createElement('option');
      option.value = team.team_code;
      option.textContent = `${team.team_name} · ${team.total}/${team.capacity}${team.available <= 0 ? ' · FULL' : ''}`;
      option.disabled = team.available <= 0;
      select.append(option);
    });
  } catch (error) {
    console.warn('Gagal memuat konfigurasi tim room:', error);
  }
}

$('joinRoomCode').addEventListener('change', loadJoinTeamsForCode);
$('joinRoomCode').addEventListener('blur', loadJoinTeamsForCode);

$('joinRoomBtn').addEventListener('click', () => {
  const code = $('joinRoomCode').value.trim().toUpperCase();
  if (!/^[A-Z0-9]{8}$/.test(code)) {
    showRoomHint('joinRoomHint', 'Kode room harus terdiri dari 8 karakter.', true);
    return;
  }
  joinRoom(code, $('joinTeam').value);
});

$('refreshRoomsBtn').addEventListener('click', () => loadRooms());
$('roomLogoutBtn').addEventListener('click', async () => {
  try {
    if (accessToken) {
      await api('/api/players/logout', { method: 'POST', body: JSON.stringify({ access_token: accessToken }) });
    }
  } catch (error) {
    console.warn('Logout API:', error);
  }
  resetPortal('Logout berhasil. Silakan login kembali.');
});

// ==========================================
// REFRESH WAITING LOBBY
// ==========================================

async function refreshLobby() {
  if (!match || !player) return;
  try {
    const result = await api(`/api/matches/${match.id}/lobby`);
    const lobby = result.lobby;
    match = {
      ...match,
      ...result.match,
      teams: lobby.teams || match.teams || []
    };

    $('lobbyRoomCode').textContent = result.match.room_code || match.room_code || 'ROOM CODE UNAVAILABLE';
    const root = $('lobbyTeams');
    root.innerHTML = '';
    let ownTeam = null;

    (lobby.teams || []).forEach(team => {
      const section = document.createElement('section');
      section.className = 'lobby-team';
      section.dataset.team = team.team_code;
      section.style.setProperty('--team-color', team.team_color || teamColor(team.team_code));

      const head = document.createElement('div');
      head.className = 'lobby-team-head';
      const title = document.createElement('div');
      title.className = 'lobby-team-title';
      const h = document.createElement('h3');
      h.textContent = `${team.team_name} TEAM`;
      const code = document.createElement('small');
      code.className = 'team-code-label';
      code.textContent = `TEAM CODE: ${team.team_code}`;
      title.append(h, code);

      const count = document.createElement('span');
      count.textContent = `${team.total} / ${team.capacity} PLAYERS`;
      head.append(title, count);

      const wrapper = document.createElement('div');
      wrapper.className = 'team-table-wrapper';
      const table = document.createElement('table');
      table.className = 'team-table';
      table.innerHTML = '<thead><tr><th>NO.</th><th>PLAYER NAME</th><th>STATUS</th></tr></thead>';
      const tbody = document.createElement('tbody');
      const players = team.players || [];

      if (!players.length) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = 3;
        td.className = 'empty-team';
        td.textContent = 'Belum ada pemain.';
        tr.append(td);
        tbody.append(tr);
      }

      players.forEach((item, index) => {
        const p = item.player || {};
        const tr = document.createElement('tr');
        const n = document.createElement('td');
        n.textContent = String(index + 1).padStart(2, '0');
        const name = document.createElement('td');
        const strong = document.createElement('strong');
        strong.textContent = p.full_name || p.username || 'Unknown';
        const small = document.createElement('small');
        small.textContent = `@${p.username || '-'}`;
        name.append(strong, document.createElement('br'), small);
        const status = document.createElement('td');
        const badge = document.createElement('span');
        badge.className = 'table-player-status';
        badge.textContent = (item.player_status || 'JOINED').toUpperCase();
        status.append(badge);
        tr.append(n, name, status);
        tbody.append(tr);
      });

      table.append(tbody);
      wrapper.append(table);
      section.append(head, wrapper);
      root.appendChild(section);

      if (players.some(item => item.player?.id === player.id)) ownTeam = team;
    });

    const teamCode = ownTeam?.team_code || window.currentPlayerTeam || 'UNKNOWN';
    $('assignment').textContent = teamCode === 'UNKNOWN' ? 'NOT ASSIGNED' : `${teamCode} TEAM`;
    $('assignment').style.color = ownTeam?.team_color || '';
    $('assignment').style.borderColor = ownTeam?.team_color || '';
    $('lobbyState').textContent = result.match.status.toUpperCase();
    $('operationStatus').textContent = result.match.status.toUpperCase();

    if (teamCode !== 'UNKNOWN') {
      window.currentPlayerTeam = teamCode;
    }

    // Sinkronkan setiap perubahan lobby ke Comms
    persistPortalContext(gameplayOpened ? 'gameplay' : 'lobby');

    if (result.match.status === 'active' && ownTeam) {
      openGameplay();
      return;
    }

    const note = result.match.status === 'active'
      ? 'Pertandingan telah dimulai. Ikuti instruksi admin.'
      : result.match.status === 'completed'
      ? 'Pertandingan telah berakhir.'
      : 'Menunggu admin memulai pertandingan.';
    const statusEl = document.querySelector('.lobby-status small');
    if (statusEl) statusEl.textContent = `${note} (${lobby.total_players}/${lobby.max_players} pemain)`;
  } catch (error) {
    console.error('Gagal memperbarui lobby:', error);
  }
}

// ==========================================
// GAMEPLAY REAL-TIME DIGITAL CLOCK
// ==========================================

function renderMatchTimer() {
  const clock = $('gameplayTimer');
  const status = $('gameplayTimerStatus');
  if (!clock) return;

  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  clock.textContent = `${hours}:${minutes}:${seconds}`;
  if (status) status.textContent = 'REAL-TIME CLOCK';
}

function startGameplayTimer() {
  stopGameplayTimer();
  renderMatchTimer();
  timerTickHandle = setInterval(renderMatchTimer, 1000);
}

function stopGameplayTimer() {
  if (timerTickHandle) clearInterval(timerTickHandle);
  if (timerSyncHandle) clearInterval(timerSyncHandle);
  timerTickHandle = null;
  timerSyncHandle = null;
}

// ==========================================
// GAMEPLAY HEALTH, MATCH STATUS & TARGET POLLING
// ==========================================

function showEliminatedScreen() {
  if (playerEliminated) return;
  playerEliminated = true;
  stopGunDetectionLoop();

  const overlay = $('eliminatedOverlay');
  if (overlay) overlay.classList.remove('hidden');

  const shootButton = $('shootBtn');
  if (shootButton) {
    shootButton.disabled = true;
    const shootLabel = shootButton.querySelector('.shoot-label');
    if (shootLabel) shootLabel.textContent = 'ELIMINATED';
  }
}

function renderGhostMode(until) {
  const indicator = $('ghostModeIndicator');
  const countdown = $('ghostModeCountdown');
  if (!indicator || !countdown) return;
  ghostModeUntil = until || null;
  if (ghostModeTickHandle) clearInterval(ghostModeTickHandle);

  const tick = () => {
    if (!ghostModeUntil) {
      indicator.classList.add('hidden');
      document.body.classList.remove('ghost-mode-active');
      return;
    }
    const remaining = Math.max(0, Math.ceil((new Date(ghostModeUntil).getTime() - Date.now()) / 1000));
    if (remaining <= 0) {
      ghostModeUntil = null;
      indicator.classList.add('hidden');
      document.body.classList.remove('ghost-mode-active');
      if (ghostModeTickHandle) clearInterval(ghostModeTickHandle);
      ghostModeTickHandle = null;
      return;
    }
    indicator.classList.remove('hidden');
    document.body.classList.add('ghost-mode-active');
    countdown.textContent = `${String(Math.floor(remaining / 60)).padStart(2, '0')}:${String(remaining % 60).padStart(2, '0')}`;
  };
  tick();
  ghostModeTickHandle = setInterval(tick, 1000);
}

async function refreshGameplayHealth() {
  if (!player || !match || !gameplayOpened) return;

  try {
    const [result, timerResult] = await Promise.all([
      api(`/api/matches/${match.id}/health`),
      api(`/api/matches/${match.id}/timer`).catch(() => null)
    ]);

    latestMatchPlayers = result.players || [];

    // Perbarui daftar target musuh yang hidup di Target Picker
    syncEnemyTargets(latestMatchPlayers);

    // Deteksi jika pertandingan sudah selesai (completed)
    if (timerResult && timerResult.status === 'completed' && match.status !== 'completed') {
      match.status = 'completed';
      $('operationStatus').textContent = 'COMPLETED';
      $('gameplayStatus').textContent = 'COMPLETED';
      stopGunDetectionLoop();
      stopGameplayGpsTracking(); // <-- TAMBAHAN
      persistPortalContext('gameplay');
      return;
    }

    const health = latestMatchPlayers.find(item => item.player_id === player.id);
    if (!health) {
      console.warn('Data health pemain tidak ditemukan.');
      return;
    }

    // Pastikan teamCode selalu ter-sync dari data otoritatif server
    if (health.team_code && window.currentPlayerTeam !== health.team_code) {
      window.currentPlayerTeam = health.team_code;
      $('gameplayTeamBadge').textContent = health.team_code;
      $('gameplayTeamBadge').className = `team-badge ${health.team_code.toLowerCase()}`;
      $('gameplayTeamBadge').style.color = teamColor(health.team_code);
    }

    persistPortalContext('gameplay');
    renderGhostMode(health.ghost_mode_until);

    const hp = Number(health.current_health);
    const maxHp = Number(health.max_health);
    const percentage = maxHp > 0 ? Math.max(0, Math.min(100, (hp / maxHp) * 100)) : 0;

    const fill = $('gameplayHealthFill');
    const text = $('gameplayHealthText');
    const status = $('gameplayHealthStatus');

    if (text) text.textContent = `${hp} / ${maxHp}`;
    if (fill) {
      fill.style.width = `${percentage}%`;
      fill.classList.toggle('low', percentage <= 25);
    }

    if (!status) return;
    status.className = 'health-status';

    if (health.is_eliminated || hp <= 0) {
      status.textContent = 'ELIMINATED';
      status.classList.add('eliminated');
      showEliminatedScreen();
    } else if (health.is_healing) {
      status.textContent = 'HEALING';
      status.classList.add('healing');
    } else {
      status.textContent = 'ALIVE';
    }
  } catch (error) {
    console.error('Gagal mengambil health:', error);
  }
}

function startGameplayHealthPolling() {
  if (healthPollHandle) clearInterval(healthPollHandle);
  refreshGameplayHealth();
  healthPollHandle = setInterval(refreshGameplayHealth, 2000);
}

function stopGameplayHealthPolling() {
  if (healthPollHandle) {
    clearInterval(healthPollHandle);
    healthPollHandle = null;
  }
}

// ==========================================
// GAMEPLAY WEAPON HUD & QR UPGRADE
// ==========================================

async function refreshGameplayWeapon() {
  if (!player || !match || !gameplayOpened) return;
  try {
    const result = await api(`/api/matches/${match.id}/weapon/${player.id}`);
    if ($('weaponName')) $('weaponName').textContent = result.weapon_name || 'TACTICAL RIFLE';
    if ($('weaponLevel')) $('weaponLevel').textContent = `WEAPON LEVEL ${result.weapon_level}`;
    if ($('weaponDamage')) $('weaponDamage').textContent = result.damage;
  } catch (error) {
    console.error('Gagal mengambil data senjata:', error);
    if ($('weaponLevel')) $('weaponLevel').textContent = 'WEAPON DATA UNAVAILABLE';
  }
}

function setWeaponScanStatus(message, isError = false) {
  const status = $('weaponScanStatus');
  if (!status) return;
  status.textContent = message;
  status.classList.add('visible');
  status.style.color = isError ? '#ff858a' : '#c7f36b';
}

function setWeaponQrModalStatus(message, isError = false) {
  const status = $('weaponQrModalStatus');
  if (!status) return;
  status.textContent = message;
  status.style.color = isError ? '#ff858a' : '#c7f36b';
}

async function stopWeaponQrScanner(restartGameplay = true) {
  const scanner = weaponQrScanner;
  weaponQrScanner = null;
  if (scanner) {
    try {
      const state = scanner.getState ? scanner.getState() : null;
      if (state === 2 || state === 1) await scanner.stop();
    } catch (error) {
      console.warn('QR scanner stop:', error);
    }
    try { scanner.clear(); } catch (_) {}
  }
  const modal = $('weaponQrModal');
  if (modal) modal.classList.add('hidden');
  const button = $('scanWeaponQrBtn');
  if (button) { button.disabled = false; button.innerHTML = '<span>01</span> SCAN QR UPGRADE'; }
  if (restartGameplay && weaponQrRestartGameplayCamera && gameplayOpened && !playerEliminated) {
    weaponQrRestartGameplayCamera = false;
    try { await startGameplayCamera(); } catch (error) { console.warn('Gameplay camera restart:', error); }
  } else {
    weaponQrRestartGameplayCamera = false;
  }
}

async function processWeaponQrPayload(qrPayload) {
  if (!player || !match || weaponQrBusy) return;
  weaponQrBusy = true;
  setWeaponScanStatus('Memvalidasi QR Weapon Upgrade...');
  setWeaponQrModalStatus('QR terbaca. Memvalidasi upgrade...');
  try {
    const result = await api(`/api/matches/${match.id}/weapon/upgrade/scan`, {
      method: 'POST',
      body: JSON.stringify({ player_id: player.id, qr_payload: qrPayload })
    });
    setWeaponScanStatus(result.message || 'Upgrade berhasil.');
    setWeaponQrModalStatus(result.message || 'Upgrade berhasil.');
    await refreshGameplayWeapon();
  } catch (error) {
    setWeaponScanStatus(error.message || 'QR tidak dapat diproses.', true);
    setWeaponQrModalStatus(error.message || 'QR tidak dapat diproses.', true);
  } finally {
    await stopWeaponQrScanner(true);
    weaponQrBusy = false;
  }
}

async function startWeaponQrScanner() {
  if (!gameplayOpened || !player || !match || playerEliminated) return;
  if (weaponQrScanner) { await stopWeaponQrScanner(true); return; }
  if (typeof Html5Qrcode === 'undefined') {
    setWeaponScanStatus('Library QR scanner gagal dimuat. Periksa koneksi internet.', true);
    return;
  }

  const modal = $('weaponQrModal');
  const button = $('scanWeaponQrBtn');
  if (modal) modal.classList.remove('hidden');
  if (button) { button.disabled = true; button.textContent = 'OPENING...'; }
  setWeaponQrModalStatus('Meminta izin kamera...');

  try {
    weaponQrRestartGameplayCamera = !!cameraStream;
    if (cameraStream) stopGameplayCamera();

    weaponQrScanner = new Html5Qrcode('weaponQrReader', {
      verbose: false,
      formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE]
    });
    const config = {
      fps: 10,
      qrbox: (viewWidth, viewHeight) => {
        const size = Math.max(160, Math.min(260, Math.floor(Math.min(viewWidth, viewHeight) * 0.72)));
        return { width: size, height: size };
      },
      aspectRatio: 1.0
    };
    await weaponQrScanner.start(
      { facingMode: 'environment' },
      config,
      async (decodedText) => {
        if (weaponQrBusy) return;
        await processWeaponQrPayload(decodedText);
      },
      () => {}
    );
    if (button) { button.disabled = false; button.innerHTML = '<span>01</span> CANCEL SCAN'; }
    setWeaponQrModalStatus('Kamera aktif. Arahkan ke QR Code stasiun upgrade.');
  } catch (error) {
    console.warn('Camera QR scanner error:', error);
    setWeaponQrModalStatus('Kamera tidak dapat dibuka. Coba pilih gambar QR dari galeri.', true);
    if (button) { button.disabled = false; button.innerHTML = '<span>01</span> SCAN QR UPGRADE'; }
  }
}

async function scanWeaponQrImage(file) {
  if (!file || !player || !match || typeof Html5Qrcode === 'undefined') return;
  setWeaponQrModalStatus('Membaca gambar QR...');
  const imageScanner = new Html5Qrcode('weaponQrReader', { verbose: false });
  try {
    const decodedText = await imageScanner.scanFile(file, true);
    await processWeaponQrPayload(decodedText);
  } catch (error) {
    setWeaponQrModalStatus('QR tidak ditemukan pada gambar. Coba foto yang lebih jelas.', true);
  } finally {
    try { imageScanner.clear(); } catch (_) {}
    $('weaponQrFile').value = '';
  }
}

// ==========================================
// GHOST MODE TREASURE QR SCANNER
// ==========================================

async function stopGhostQrScanner(restartGameplay = true) {
  const scanner = ghostQrScanner;
  ghostQrScanner = null;
  if (scanner) {
    try {
      const state = scanner.getState ? scanner.getState() : null;
      if (state === 2 || state === 1) await scanner.stop();
    } catch (error) { console.warn('Ghost QR scanner stop:', error); }
    try { scanner.clear(); } catch (_) {}
  }
  $('ghostQrModal')?.classList.add('hidden');
  const button = $('scanGhostQrBtn');
  if (button) { button.disabled = false; button.innerHTML = '<span>02</span> GHOST MODE'; }
  if (restartGameplay && ghostQrRestartGameplayCamera && gameplayOpened && !playerEliminated) {
    ghostQrRestartGameplayCamera = false;
    try { await startGameplayCamera(); } catch (error) { console.warn('Gameplay camera restart:', error); }
  } else {
    ghostQrRestartGameplayCamera = false;
  }
}

async function processGhostQrPayload(qrPayload) {
  if (!player || !match || ghostQrBusy) return;
  ghostQrBusy = true;
  $('ghostQrModalStatus').textContent = 'QR terbaca. Memvalidasi treasure...';
  try {
    const result = await api(`/api/matches/${match.id}/ghost-mode/scan`, {
      method: 'POST',
      body: JSON.stringify({ player_id: player.id, qr_payload: qrPayload })
    });
    $('ghostQrModalStatus').textContent = result.message || 'Ghost Mode berhasil diaktifkan.';
    renderGhostMode(result.ghost_mode_until);
    setTimeout(() => stopGhostQrScanner(true), 1200);
  } catch (error) {
    $('ghostQrModalStatus').textContent = error.message || 'QR tidak dapat diproses.';
    $('ghostQrModalStatus').style.color = '#ff858a';
    await stopGhostQrScanner(true);
  } finally {
    ghostQrBusy = false;
  }
}

async function startGhostQrScanner() {
  if (!gameplayOpened || !player || !match || playerEliminated) return;
  if (ghostQrScanner) { await stopGhostQrScanner(true); return; }
  if (typeof Html5Qrcode === 'undefined') { alert('Library QR scanner belum dimuat.'); return; }
  $('ghostQrModal').classList.remove('hidden');
  $('ghostQrModalStatus').textContent = 'Meminta izin kamera...';
  const button = $('scanGhostQrBtn');
  if (button) { button.disabled = true; button.textContent = 'OPENING...'; }
  try {
    ghostQrRestartGameplayCamera = !!cameraStream;
    if (cameraStream) stopGameplayCamera();
    ghostQrScanner = new Html5Qrcode('ghostQrReader', { verbose: false, formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE] });
    await ghostQrScanner.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: (w, h) => { const size = Math.max(160, Math.min(260, Math.floor(Math.min(w, h) * 0.72))); return { width: size, height: size }; }, aspectRatio: 1 },
      async decoded => { if (!ghostQrBusy) await processGhostQrPayload(decoded); },
      () => {}
    );
    if (button) { button.disabled = false; button.innerHTML = '<span>02</span> CANCEL SCAN'; }
    $('ghostQrModalStatus').textContent = 'Kamera aktif. Arahkan ke QR Treasure Ghost Mode.';
  } catch (error) {
    console.warn('Ghost QR camera error:', error);
    $('ghostQrModalStatus').textContent = 'Kamera tidak dapat dibuka. Pilih gambar QR dari galeri.';
    $('ghostQrModalStatus').style.color = '#ff858a';
    if (button) { button.disabled = false; button.innerHTML = '<span>02</span> GHOST MODE'; }
  }
}

async function scanGhostQrImage(file) {
  if (!file || !player || !match || typeof Html5Qrcode === 'undefined') return;
  $('ghostQrModalStatus').textContent = 'Membaca gambar QR...';
  const scanner = new Html5Qrcode('ghostQrReader', { verbose: false });
  try {
    const decoded = await scanner.scanFile(file, true);
    await processGhostQrPayload(decoded);
  } catch (error) {
    $('ghostQrModalStatus').textContent = 'QR tidak ditemukan pada gambar.';
    $('ghostQrModalStatus').style.color = '#ff858a';
  } finally {
    try { scanner.clear(); } catch (_) {}
    $('ghostQrFile').value = '';
  }
}

// ==========================================
// BASE HEALING: QR + POSE DETECTOR BRIDGE
// ==========================================

let healingQrScanner = null;
let healingQrBusy = false;
let healingQrRestartGameplayCamera = false;
let healingStationPayload = null;
let healingPoseTimer = null;
let healingPoseStartedAt = null;
let healingPoseValid = false;
let healingCompleteBusy = false;
const HEALING_POSE_HOLD_SECONDS = 5;

function setHealingStatus(message, isError = false) {
  const el = $('healingQrStatus');
  if (el) { el.textContent = message; el.style.color = isError ? '#ff858a' : '#9bf0c9'; }
}
function setHealingPoseStatus(message, isError = false) {
  const el = $('healingPoseStatus');
  if (el) { el.textContent = message; el.style.color = isError ? '#ff858a' : '#9bf0c9'; }
}
function resetHealingPoseProgress() {
  healingPoseStartedAt = null;
  const fill = $('healingProgressFill'); if (fill) fill.style.width = '0%';
  const countdown = $('healingCountdown'); if (countdown) countdown.textContent = 'POSE BELUM TERDETEKSI';
}
async function stopHealingQrScanner(restartGameplay = true) {
  if (healingPoseTimer) clearInterval(healingPoseTimer);
  healingPoseTimer = null; healingPoseValid = false; healingStationPayload = null;
  const scanner = healingQrScanner; healingQrScanner = null;
  if (scanner) { try { const state = scanner.getState?.(); if (state === 2 || state === 1) await scanner.stop(); } catch (_) {} try { scanner.clear(); } catch (_) {} }
  $('healingQrModal')?.classList.add('hidden');
  $('healingMenu')?.classList.add('hidden');
  resetHealingPoseProgress();
  if (restartGameplay && healingQrRestartGameplayCamera && gameplayOpened && !playerEliminated) {
    healingQrRestartGameplayCamera = false; try { await startGameplayCamera(); } catch (e) { console.warn(e); }
  } else healingQrRestartGameplayCamera = false;
}
async function processHealingQrPayload(payload) {
  if (healingQrBusy || !player || !match) return;
  healingQrBusy = true;
  try {
    if (!String(payload).startsWith('OPS-HEALING:')) throw new Error('QR bukan QR Healing Base.');
    healingStationPayload = String(payload).trim();
    $('healingMenu')?.classList.remove('hidden');
    $('healingQrReader')?.classList.add('hidden');
    $('healingQrFile')?.classList.add('hidden');
    setHealingStatus('QR terbaca. Lakukan pose healing untuk memulai pemulihan.');
    setHealingPoseStatus('Menunggu sinyal dari pose detector...');
    if (window.OPERATION_SURABAYA_POSE_DETECTOR_READY !== true) {
      setHealingPoseStatus('Pose detector belum terhubung. Hubungkan modul pose yang sudah kamu definisikan.', true);
    }
  } catch (e) { setHealingStatus(e.message || 'QR tidak valid.', true); }
  finally { healingQrBusy = false; }
}
async function startHealingQrScanner() {
  if (!gameplayOpened || !player || !match || playerEliminated) return;
  if (typeof Html5Qrcode === 'undefined') { setHealingStatus('Library QR scanner gagal dimuat.', true); return; }
  $('healingQrModal')?.classList.remove('hidden');
  $('healingMenu')?.classList.add('hidden');
  $('healingQrReader')?.classList.remove('hidden');
  $('healingQrFile')?.classList.remove('hidden');
  setHealingStatus('Meminta izin kamera...');
  try {
    healingQrRestartGameplayCamera = !!cameraStream; if (cameraStream) stopGameplayCamera();
    healingQrScanner = new Html5Qrcode('healingQrReader', { verbose: false, formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE] });
    await healingQrScanner.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: (w, h) => { const z = Math.max(160, Math.min(260, Math.floor(Math.min(w, h) * 0.72))); return { width: z, height: z }; }, aspectRatio: 1 },
      async decoded => {
        if (!healingQrBusy) {
          const activeScanner = healingQrScanner; healingQrScanner = null;
          try { await activeScanner.stop(); } catch (_) {}
          try { activeScanner.clear(); } catch (_) {}
          $('healingQrModal')?.classList.remove('hidden');
          healingStationPayload = decoded;
          await processHealingQrPayload(decoded);
        }
      },
      () => {}
    );
    setHealingStatus('Kamera aktif. Scan QR yang terpasang di base tim kamu.');
  } catch (e) { setHealingStatus('Kamera tidak tersedia. Pilih gambar QR dari galeri.', true); }
}
async function scanHealingQrImage(file) {
  if (!file || typeof Html5Qrcode === 'undefined') return;
  const scanner = new Html5Qrcode('healingQrReader', { verbose: false });
  try { const decoded = await scanner.scanFile(file, true); await processHealingQrPayload(decoded); }
  catch (_) { setHealingStatus('QR tidak ditemukan pada gambar.', true); }
  finally { try { scanner.clear(); } catch (_) {} $('healingQrFile').value = ''; }
}
async function completeHealingFromPose() {
  if (healingCompleteBusy || !healingStationPayload || !player || !match) return;
  healingCompleteBusy = true;
  setHealingPoseStatus('Pose valid. Memproses healing...');
  try {
    const result = await api(`/api/matches/${match.id}/heal`, {
      method: 'POST',
      body: JSON.stringify({ player_id: player.id, qr_payload: healingStationPayload, pose_verified: true })
    });
    setHealingPoseStatus(result.message || 'Healing berhasil.');
    setHealingStatus(`HP sekarang ${result.current_health}/${result.max_health}.`);
    await refreshGameplayHealth();
    setTimeout(() => stopHealingQrScanner(true), 1500);
  } catch (e) { setHealingPoseStatus(e.message || 'Healing gagal.', true); }
  finally { healingCompleteBusy = false; resetHealingPoseProgress(); }
}
function handleHealingPoseSignal(event) {
  const valid = !!event?.detail?.valid;
  if (!healingStationPayload || $('healingMenu')?.classList.contains('hidden')) return;
  healingPoseValid = valid;
  if (!valid) {
    if (healingPoseTimer) clearInterval(healingPoseTimer); healingPoseTimer = null; resetHealingPoseProgress();
    setHealingPoseStatus('Pose tidak terdeteksi. Pertahankan pose healing yang benar.'); return;
  }
  if (healingPoseTimer) return;
  healingPoseStartedAt = Date.now();
  setHealingPoseStatus('Pose terdeteksi. Pertahankan selama 5 detik.');
  healingPoseTimer = setInterval(() => {
    if (!healingPoseValid) return;
    const elapsed = (Date.now() - healingPoseStartedAt) / 1000;
    const pct = Math.min(100, elapsed / HEALING_POSE_HOLD_SECONDS * 100);
    if ($('healingProgressFill')) $('healingProgressFill').style.width = `${pct}%`;
    const left = Math.max(0, Math.ceil(HEALING_POSE_HOLD_SECONDS - elapsed));
    if ($('healingCountdown')) $('healingCountdown').textContent = `PERTAHANKAN POSE · ${left} DETIK`;
    if (elapsed >= HEALING_POSE_HOLD_SECONDS) { clearInterval(healingPoseTimer); healingPoseTimer = null; completeHealingFromPose(); }
  }, 100);
}
window.addEventListener('ops-healing-pose-valid', handleHealingPoseSignal);

// ==========================================
// GAMEPLAY SHOOT ACTION (VALIDATED WITH WEAPON + PLATE + TEAM CHECK)
// ==========================================

async function sendShootEvent() {
  const button = $('shootBtn');
  const targetPlayerId = $('targetSelect')?.value || '';

  if (!player || !match || playerEliminated || shootCooldown || !button || button.disabled) {
    return;
  }

  if (!targetPlayerId) {
    if ($('gunStatus')) {
      $('gunStatus').textContent = 'PILIH TARGET MUSUH TERLEBIH DAHULU';
      $('gunStatus').style.color = '#ff858a';
    }
    return;
  }

  const freshFrame = captureGameplayFrameBase64(0.8, 416);
  if (!freshFrame || !latestGunDetection.detected) {
    if ($('gunStatus')) {
      $('gunStatus').textContent = 'SENJATA TIDAK TERDETEKSI';
      $('gunStatus').style.color = '#ff858a';
    }
    updateShootButtonReadiness();
    return;
  }

  if (latestGunDetection.relation === 'teammate') {
    if ($('gunStatus')) {
      $('gunStatus').textContent = 'DILARANG MENEMBAK REKAN SATU TIM';
      $('gunStatus').style.color = '#ff858a';
    }
    updateShootButtonReadiness();
    return;
  }

  shootCooldown = true;
  button.disabled = true;

  const shootLabel = button.querySelector('.shoot-label');
  if (shootLabel) {
    shootLabel.textContent = 'FIRING...';
  }

  try {
    const result = await api(`/api/matches/${match.id}/shoot`, {
      method: 'POST',
      body: JSON.stringify({
        player_id: player.id,
        target_player_id: targetPlayerId,
        image: freshFrame
      })
    });

    if (shootLabel) {
      shootLabel.textContent = result.blocked_by_ghost_mode
        ? 'GHOST BLOCKED'
        : `SHOT · -${result.damage_applied ?? result.weapon_damage ?? 10} HP`;
    }

    // Perbarui daftar target & HP segera setelah tembakan berhasil
    await refreshGameplayHealth();
  } catch (error) {
    console.error('Shoot gagal:', error);
    if (shootLabel) {
      shootLabel.textContent = 'MISSED';
    }
    if ($('gunStatus')) {
      $('gunStatus').textContent = error.message || 'TEMBAKAN GAGAL';
      $('gunStatus').style.color = '#ff858a';
    }
  } finally {
    setTimeout(() => {
      shootCooldown = false;
      if (!playerEliminated && button) {
        if (shootLabel) shootLabel.textContent = 'FIRE';
        updateShootButtonReadiness();
      }
    }, 1000);
  }
}

// ==========================================
// BASE SHUTDOWN QR & NOTIFICATIONS
// ==========================================

let baseShutdownScanner = null;
let baseShutdownBusy = false;
let baseShutdownTimer = null;
let baseShutdownRestartGameplayCamera = false;
let baseShutdownInProgress = false;
let baseShutdownEventPollHandle = null;
let seenBaseShutdownEventIds = new Set();
let baseShutdownEventsInitialized = false;
let baseDefenseNotificationTimer = null;

function showBaseDefenseNotification(attackerTeam) {
  const panel = $('baseDefenseNotification');
  if (!panel) return;
  $('baseDefenseNotificationTitle').textContent = 'BASE UNDER ATTACK!';
  $('baseDefenseNotificationMessage').textContent = `Tim ${attackerTeam} sedang mencoba menonaktifkan base ${window.currentPlayerTeam}. Segera pertahankan base kalian!`;
  panel.classList.remove('hidden');
  panel.classList.add('visible');
  if (baseDefenseNotificationTimer) clearTimeout(baseDefenseNotificationTimer);
  baseDefenseNotificationTimer = setTimeout(() => panel.classList.remove('visible'), 10000);
}

async function pollBaseShutdownNotifications() {
  if (!player || !match || !gameplayOpened) return;
  try {
    const result = await api(`/api/matches/${match.id}/events`);
    const events = result.events || [];
    if (!baseShutdownEventsInitialized) {
      events.forEach(event => { if (event.id) seenBaseShutdownEventIds.add(event.id); });
      baseShutdownEventsInitialized = true;
      return;
    }
    const ownTeam = String(window.currentPlayerTeam || '').toUpperCase();
    events.slice().reverse().forEach(event => {
      if (!event.id || seenBaseShutdownEventIds.has(event.id)) return;
      seenBaseShutdownEventIds.add(event.id);
      if (event.event_type === 'base_shutdown_success') {
        const winTeam = event.event_data?.attacker_team_code || '';
        if ($('gameplayStatus')) $('gameplayStatus').textContent = `${winTeam} WIN`;
        if (match) match.status = 'completed';
        stopGunDetectionLoop();
        stopGameplayGpsTracking(); // <-- TAMBAHAN
        persistPortalContext('gameplay');
        return;
      }
      if (event.event_type !== 'base_shutdown_started') return;
      const data = event.event_data || {};
      if (String(data.defender_team_code || '').toUpperCase() === ownTeam) {
        showBaseDefenseNotification(String(data.attacker_team_code || 'LAWAN').toUpperCase());
      }
    });
    if (seenBaseShutdownEventIds.size > 300) seenBaseShutdownEventIds = new Set([...seenBaseShutdownEventIds].slice(-150));
  } catch (error) {
    console.warn('Gagal memeriksa notifikasi Base Shutdown:', error);
  }
}

function startBaseShutdownNotificationPolling() {
  stopBaseShutdownNotificationPolling();
  seenBaseShutdownEventIds = new Set();
  baseShutdownEventsInitialized = false;
  pollBaseShutdownNotifications();
  baseShutdownEventPollHandle = setInterval(pollBaseShutdownNotifications, 1500);
}

function stopBaseShutdownNotificationPolling() {
  if (baseShutdownEventPollHandle) clearInterval(baseShutdownEventPollHandle);
  baseShutdownEventPollHandle = null;
  if (baseDefenseNotificationTimer) clearTimeout(baseDefenseNotificationTimer);
  baseDefenseNotificationTimer = null;
}

function setBaseShutdownStatus(message, isError = false) {
  const el = $('baseShutdownStatus');
  if (el) { el.textContent = message; el.style.color = isError ? '#ff858a' : ''; }
}
async function stopBaseShutdownScanner(restartGameplay = true) {
  if (baseShutdownTimer) { clearInterval(baseShutdownTimer); baseShutdownTimer = null; }
  const scanner = baseShutdownScanner; baseShutdownScanner = null;
  if (scanner) { try { const state = scanner.getState?.(); if (state === 2 || state === 1) await scanner.stop(); } catch (e) { console.warn(e); } try { scanner.clear(); } catch (_) {} }
  $('baseShutdownModal')?.classList.add('hidden');
  $('baseShutdownCountdown')?.classList.add('hidden');
  const button = $('scanBaseShutdownBtn');
  if (button) { button.disabled = false; button.innerHTML = '<span>04</span> SHUTDOWN BASE'; }
  if (restartGameplay && baseShutdownRestartGameplayCamera && gameplayOpened && !playerEliminated) {
    baseShutdownRestartGameplayCamera = false;
    try { await startGameplayCamera(); } catch (e) { console.warn(e); }
  } else baseShutdownRestartGameplayCamera = false;
}
async function finishBaseShutdown(payload) {
  if (!player || !match || baseShutdownBusy) return;
  baseShutdownBusy = true;
  try {
    await api(`/api/matches/${match.id}/base-shutdown/start`, {
      method: 'POST',
      body: JSON.stringify({ player_id: player.id, qr_payload: payload })
    });
  } catch (error) {
    baseShutdownBusy = false;
    setBaseShutdownStatus(error.message || 'Tidak dapat memulai Base Shutdown.', true);
    return;
  }
  baseShutdownInProgress = true;
  const countdown = $('baseShutdownCountdown');
  let remaining = 10;
  countdown?.classList.remove('hidden');
  if (countdown) countdown.textContent = String(remaining);
  setBaseShutdownStatus('QR valid. Pertahankan posisi sampai proses shutdown selesai.');
  const button = $('cancelBaseShutdownBtn');
  if (button) button.textContent = 'BATALKAN PROSES';
  baseShutdownTimer = setInterval(async () => {
    remaining--;
    if (countdown) countdown.textContent = String(remaining);
    if (remaining <= 0) {
      clearInterval(baseShutdownTimer);
      baseShutdownTimer = null;
      try {
        const result = await api(`/api/matches/${match.id}/base-shutdown/complete`, {
          method: 'POST',
          body: JSON.stringify({ player_id: player.id, qr_payload: payload })
        });
        setBaseShutdownStatus(result.message || 'Base lawan berhasil dinonaktifkan.');
        if (countdown) countdown.textContent = 'SUCCESS';
        const status = $('gameplayStatus');
        if (status) status.textContent = `${result.winner_team_code} WIN`;
        if (match) match.status = 'completed';
        stopGunDetectionLoop();
        stopGameplayGpsTracking(); // <-- TAMBAHAN
        persistPortalContext('gameplay');
        setTimeout(() => stopBaseShutdownScanner(false), 2500);
      } catch (error) {
        setBaseShutdownStatus(error.message || 'Shutdown gagal.', true);
        baseShutdownInProgress = false;
        setTimeout(() => stopBaseShutdownScanner(true), 1800);
      } finally {
        baseShutdownBusy = false;
      }
    }
  }, 1000);
}
async function processBaseShutdownPayload(payload) {
  if (!player || !match || baseShutdownBusy) return;
  const clean = String(payload || '').trim();
  if (!clean.startsWith('OPS-BASE-SHUTDOWN:')) { setBaseShutdownStatus('QR bukan QR Base Shutdown.', true); return; }
  const code = clean.slice('OPS-BASE-SHUTDOWN:'.length).trim();
  if (!/^BASE-(RED|BLUE|GREEN|YELLOW)$/.test(code)) { setBaseShutdownStatus('Kode base tidak valid.', true); return; }
  if (baseShutdownScanner) { const sc = baseShutdownScanner; baseShutdownScanner = null; try { await sc.stop(); } catch (_) {} try { sc.clear(); } catch (_) {} }
  await finishBaseShutdown(clean);
}
async function startBaseShutdownScanner() {
  if (!gameplayOpened || !player || !match || playerEliminated || baseShutdownBusy) return;
  if (typeof Html5Qrcode === 'undefined') { setBaseShutdownStatus('Library QR scanner gagal dimuat.', true); return; }
  $('baseShutdownModal')?.classList.remove('hidden');
  setBaseShutdownStatus('Meminta izin kamera...');
  baseShutdownRestartGameplayCamera = !!cameraStream;
  if (cameraStream) stopGameplayCamera();
  try {
    baseShutdownScanner = new Html5Qrcode('baseShutdownReader', { verbose: false, formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE] });
    await baseShutdownScanner.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: (w, h) => { const n = Math.max(160, Math.min(260, Math.floor(Math.min(w, h) * 0.72))); return { width: n, height: n }; }, aspectRatio: 1 },
      async text => { if (!baseShutdownBusy) await processBaseShutdownPayload(text); },
      () => {}
    );
    setBaseShutdownStatus('Kamera aktif. Scan QR Base milik tim lawan.');
  } catch (e) {
    setBaseShutdownStatus('Kamera tidak dapat dibuka. Gunakan gambar QR dari galeri.', true);
  }
}
async function scanBaseShutdownImage(file) {
  if (!file || typeof Html5Qrcode === 'undefined') return;
  const scanner = new Html5Qrcode('baseShutdownReader', { verbose: false });
  try { const decoded = await scanner.scanFile(file, true); await processBaseShutdownPayload(decoded); }
  catch (e) { setBaseShutdownStatus('QR tidak terbaca. Coba gambar yang lebih jelas.', true); }
  finally { try { scanner.clear(); } catch (_) {} $('baseShutdownFile').value = ''; }
}

// ==========================================
// GAMEPLAY CONTROLS & EVENT LISTENERS
// ==========================================

$('enableCameraBtn').addEventListener('click', startGameplayCamera);
$('shootBtn').addEventListener('click', sendShootEvent);
$('targetSelect')?.addEventListener('change', updateShootButtonReadiness);

$('fullscreenBtn')?.addEventListener('click', () => {
  const target = $('gameplayPanel') || document.documentElement;
  if (!document.fullscreenElement) {
    target.requestFullscreen?.().catch(() => {});
  } else {
    document.exitFullscreen?.().catch(() => {});
  }
});

const gameActionsDropdown = $('gameplayActionDropdown');
const gameActionsToggle = $('gameActionsToggle');
const gameActionsMenu = $('gameplayActionMenu');
function setGameActionsDropdown(open) {
  if (!gameActionsDropdown || !gameActionsToggle || !gameActionsMenu) return;
  gameActionsDropdown.classList.toggle('is-open', open);
  gameActionsMenu.classList.toggle('hidden', !open);
  gameActionsToggle.setAttribute('aria-expanded', String(open));
  $('gameplayPanel')?.classList.toggle('menu-open', open);
}
gameActionsToggle?.addEventListener('click', (event) => {
  event.stopPropagation();
  setGameActionsDropdown(gameActionsMenu?.classList.contains('hidden'));
});
gameActionsMenu?.addEventListener('click', (event) => {
  if (event.target.closest('button')) setGameActionsDropdown(false);
});
document.addEventListener('click', (event) => {
  if (gameActionsDropdown && !gameActionsDropdown.contains(event.target)) setGameActionsDropdown(false);
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') setGameActionsDropdown(false);
});

// Indikator status GPS / kamera berupa titik berwarna (teks lengkap tersimpan di atribut title)
function classifyHudStatus(text) {
  const value = String(text || '').toUpperCase();
  if (/ERROR|BLOCKED|DENIED|UNSUPPORTED|UNAVAILABLE|FAILED|OFF/.test(value)) return 'err';
  if (/CONFIRMED|CONNECTED|ACTIVE/.test(value)) return 'ok';
  return 'warn';
}
['gpsStatus', 'cameraStatus'].forEach((id) => {
  const el = $(id);
  if (!el) return;
  const sync = () => {
    el.dataset.state = classifyHudStatus(el.textContent);
    el.title = el.textContent;
  };
  new MutationObserver(sync).observe(el, { childList: true, characterData: true, subtree: true });
  sync();
});

$('scanWeaponQrBtn').addEventListener('click', startWeaponQrScanner);
$('scanBaseShutdownBtn').addEventListener('click', startBaseShutdownScanner);
$('closeBaseDefenseNotification').addEventListener('click', () => $('baseDefenseNotification')?.classList.remove('visible'));
$('closeBaseShutdownBtn').addEventListener('click', () => stopBaseShutdownScanner(true));
$('cancelBaseShutdownBtn').addEventListener('click', () => {
  if (baseShutdownTimer) { clearInterval(baseShutdownTimer); baseShutdownTimer = null; }
  baseShutdownBusy = false;
  baseShutdownInProgress = false;
  setBaseShutdownStatus('Proses shutdown dibatalkan.', true);
  stopBaseShutdownScanner(true);
});
$('baseShutdownFile').addEventListener('change', event => scanBaseShutdownImage(event.target.files?.[0]));
$('closeWeaponQrBtn').addEventListener('click', () => stopWeaponQrScanner(true));
$('cancelWeaponQrBtn').addEventListener('click', () => stopWeaponQrScanner(true));
$('weaponQrFile').addEventListener('change', (event) => scanWeaponQrImage(event.target.files?.[0]));
$('scanGhostQrBtn').addEventListener('click', startGhostQrScanner);
$('openHealingBtn').addEventListener('click', startHealingQrScanner);
$('closeHealingQrBtn').addEventListener('click', () => stopHealingQrScanner(true));
$('cancelHealingQrBtn').addEventListener('click', () => stopHealingQrScanner(true));
$('healingQrFile').addEventListener('change', event => scanHealingQrImage(event.target.files?.[0]));
$('closeGhostQrBtn').addEventListener('click', () => stopGhostQrScanner(true));
$('cancelGhostQrBtn').addEventListener('click', () => stopGhostQrScanner(true));
$('ghostQrFile').addEventListener('change', (event) => scanGhostQrImage(event.target.files?.[0]));

$('gameplayLogoutBtn').addEventListener('click', async () => {
  if (!window.confirm('Keluar dari permainan?')) return;
  await stopGhostQrScanner(false);
  if (ghostModeTickHandle) clearInterval(ghostModeTickHandle);
  ghostModeTickHandle = null;
  try {
    if (accessToken) {
      await api('/api/players/logout', { method: 'POST', body: JSON.stringify({ access_token: accessToken }) });
    }
    stopGameplayCamera();
    stopGameplayGpsTracking();
    gameplayOpened = false;
    stopBaseShutdownNotificationPolling();
    resetPortal('Logout berhasil. Silakan login kembali.');
  } catch (error) {
    $('cameraMessage').textContent = error.message;
  }
});

$('leaveBtn').addEventListener('click', async () => {
  const button = $('leaveBtn');
  button.disabled = true;
  button.textContent = 'LOGGING OUT...';
  try {
    if (accessToken) {
      await api('/api/players/logout', { method: 'POST', body: JSON.stringify({ access_token: accessToken }) });
    }
    resetPortal('Logout berhasil. Silakan login kembali.');
  } catch (error) {
    setHint('lobbyHint', error.message, true);
  } finally {
    button.disabled = false;
    button.textContent = 'LOG OUT';
  }
});

$('leaveTeamBtn').addEventListener('click', async () => {
  if (!player || !match) return;
  const button = $('leaveTeamBtn');
  button.disabled = true;
  button.textContent = 'LEAVING TEAM...';
  try {
    if (pollHandle) { clearInterval(pollHandle); pollHandle = null; }
    await api(`/api/matches/${match.id}/leave`, {
      method: 'POST',
      body: JSON.stringify({ player_id: player.id })
    });

    $('lobbyPanel').classList.add('hidden');
    $('teamPanel').classList.add('hidden');
    $('roomPanel').classList.remove('hidden');
    document.body.classList.remove('in-gameplay');

    match = null;
    window.currentPlayerTeam = null;
    latestMatchPlayers = [];
    persistPortalContext('rooms');

    $('operationStatus').textContent = 'ROOM BROWSER';
    $('roomWelcome').textContent = `Logged in as ${player.full_name} (@${player.username})`;
    $('roomPlayerName').textContent = `${player.player_number ? `#${player.player_number} · ` : ''}${player.username || player.full_name}`;
    showRoomHint('roomListHint', 'Berhasil keluar dari tim. Pilih room lain atau buat room baru.');
    await loadRooms();
  } catch (error) {
    setHint('lobbyHint', error.message, true);
    pollHandle = setInterval(refreshLobby, 3000);
  } finally {
    button.disabled = false;
    button.textContent = 'LEAVE TEAM';
  }
});

function resetPortal(message) {
  if (pollHandle) clearInterval(pollHandle);
  stopGameplayCamera();
  stopGameplayGpsTracking();
  stopGameplayHealthPolling();
  stopWeaponQrScanner();
  stopBaseShutdownNotificationPolling();

  gameplayOpened = false;
  shootCooldown = false;
  playerEliminated = false;
  document.body.classList.remove('in-gameplay');

  if (document.fullscreenElement) {
    document.exitFullscreen?.().catch(() => {});
  }

  const overlay = $('eliminatedOverlay');
  if (overlay) overlay.classList.add('hidden');

  const shootButton = $('shootBtn');
  if (shootButton) {
    shootButton.disabled = false;
    shootButton.classList.remove('ready-to-fire', 'no-target');
    const shootLabel = shootButton.querySelector('.shoot-label');
    if (shootLabel) shootLabel.textContent = 'FIRE';
  }

  $('gameplayPanel').classList.add('hidden');
  pollHandle = null;
  player = null;
  match = null;
  window.currentPlayerTeam = null;
  latestMatchPlayers = [];

  saveToken(null);

  $('lobbyPanel').classList.add('hidden');
  $('roomPanel').classList.add('hidden');
  $('teamPanel').classList.add('hidden');
  $('loginPanel').classList.remove('hidden');

  if ($('loginEmail')) $('loginEmail').value = '';
  if ($('loginPassword')) $('loginPassword').value = '';
  if ($('playerName')) $('playerName').value = '';
  if ($('fullName')) $('fullName').value = '';
  if ($('playerNumber')) $('playerNumber').value = '';
  if ($('playerEmail')) $('playerEmail').value = '';
  if ($('registerPassword')) $('registerPassword').value = '';

  $('operationStatus').textContent = 'STANDBY';
  showAuth('login');
  setHint('loginHint', message);
}

// ==========================================
// FACE RECOGNITION BIOMETRIC SYSTEM
// ==========================================

let authStream = null;
let isWebcamReady = false;

function stopAuthCamera() {
  if (authStream) {
    authStream.getTracks().forEach((track) => track.stop());
    authStream = null;
  }
  isWebcamReady = false;
  const webcam = $('authWebcam');
  if (webcam) webcam.srcObject = null;
}
let faceTrackerHandle = null;
let isFaceApiLoaded = false;

async function loadFaceTrackerModels() {
  if (typeof faceapi === 'undefined' || isFaceApiLoaded) return;
  try {
    await faceapi.nets.ssdMobilenetv1.loadFromUri('models');
    isFaceApiLoaded = true;
  } catch (e) {
    console.warn('[FACE-API] Tidak dapat memuat model lokal:', e);
  }
}

function startFaceTracking() {
  const video = $('authWebcam');
  const overlay = $('authOverlay');
  const badge = $('faceBadge');
  if (!video || !overlay) return;
  if (faceTrackerHandle) { clearInterval(faceTrackerHandle); faceTrackerHandle = null; }
  const ctx = overlay.getContext('2d');

  faceTrackerHandle = setInterval(async () => {
    if (!authStream || video.paused || video.ended || video.videoWidth === 0) return;
    if (overlay.width !== video.videoWidth || overlay.height !== video.videoHeight) {
      overlay.width = video.videoWidth;
      overlay.height = video.videoHeight;
    }
    ctx.clearRect(0, 0, overlay.width, overlay.height);

    if (typeof faceapi !== 'undefined' && isFaceApiLoaded) {
      try {
        const detection = await faceapi.detectSingleFace(video);
        if (detection && detection.box) {
          const { x, y, width, height } = detection.box;
          const mirX = overlay.width - x - width;
          ctx.save();
          ctx.strokeStyle = '#00ff88';
          ctx.lineWidth = 3;
          ctx.shadowColor = '#00ff88';
          ctx.shadowBlur = 10;
          const len = Math.min(width, height) * 0.25;
          ctx.beginPath(); ctx.moveTo(mirX, y + len); ctx.lineTo(mirX, y); ctx.lineTo(mirX + len, y); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(mirX + width - len, y); ctx.lineTo(mirX + width, y); ctx.lineTo(mirX + width, y + len); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(mirX + width, y + height - len); ctx.lineTo(mirX + width, y + height); ctx.lineTo(mirX + width - len, y + height); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(mirX + len, y + height); ctx.lineTo(mirX, y + height); ctx.lineTo(mirX, y + height - len); ctx.stroke();
          ctx.fillStyle = '#00ff88';
          ctx.font = 'bold 14px "DM Mono", monospace';
          ctx.textAlign = 'left';
          ctx.fillText('WAJAH TERDETEKSI', mirX, y > 25 ? y - 8 : y + 20);
          ctx.restore();

          if (badge) {
            badge.textContent = 'WAJAH TERDETEKSI · SIAP PINDAI';
            badge.className = 'face-status-badge success';
          }
          const bioStatus = $('faceSampleStatus');
          if (bioStatus) bioStatus.textContent = '✓ Wajah terdeteksi dan berada dalam fokus';
        } else if (badge) {
          badge.textContent = 'MENCARI WAJAH...';
          badge.className = 'face-status-badge scanning';
        }
      } catch (_) {}
    }
  }, 150);
}

function captureWebcamFrameBase64() {
  const video = $('authWebcam');
  const canvas = $('snapshotCanvas') || document.createElement('canvas');
  if (!video || !authStream || video.videoWidth === 0) return null;
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.85);
}

async function requestCameraAccess() {
  const webcam = $('authWebcam');
  const badge = $('faceBadge');
  const instruction = $('faceInstruction');
  const promptBox = $('cameraPermPrompt');
  if (!webcam) return;

  if (badge) badge.textContent = 'MEMINTA IZIN KAMERA...';
  if (instruction) instruction.textContent = 'Izinkan akses kamera pada pop-up browser (Allow).';

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    if (badge) { badge.textContent = 'KAMERA TIDAK DIDUKUNG'; badge.className = 'face-status-badge scanning'; }
    if (instruction) instruction.textContent = 'Browser tidak mendukung getUserMedia atau halaman dibuka tanpa localhost/HTTPS.';
    return;
  }

  try {
    authStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    webcam.srcObject = authStream;
    isWebcamReady = true;
    if (promptBox) promptBox.classList.add('hidden');
    try { await webcam.play(); } catch (_) {}
    if (badge) { badge.textContent = 'KAMERA AKTIF · SIAP PINDAI'; badge.className = 'face-status-badge success'; }
    if (instruction) instruction.textContent = 'Arahkan wajah Anda ke kamera lalu tekan tombol Scan Wajah / Daftar.';
    const bioStatus = $('faceSampleStatus');
    if (bioStatus) bioStatus.textContent = '✓ Sensor kamera siap menangkap wajah';
    const bioInd = $('bioIndicator');
    if (bioInd) bioInd.classList.add('ready');
    loadFaceTrackerModels().then(() => startFaceTracking());
  } catch (err) {
    isWebcamReady = false;
    if (promptBox) promptBox.classList.remove('hidden');
    if (badge) { badge.textContent = 'IZIN KAMERA DITOLAK / GAGAL'; badge.className = 'face-status-badge scanning'; }
    if (instruction) instruction.textContent = err.name + ': ' + err.message;
  }
}

function setupFaceAuthEvents() {
  requestCameraAccess();
  $('requestCameraBtn')?.addEventListener('click', (e) => { e.preventDefault(); requestCameraAccess(); });

  const faceLoginBtn = $('faceLoginBtn');
  if (faceLoginBtn) {
    faceLoginBtn.addEventListener('click', async () => {
      if (!authStream) await requestCameraAccess();
      const snapshot = captureWebcamFrameBase64();
      if (!snapshot) {
        setHint('loginHint', 'Kamera belum siap atau belum aktif.', true);
        return;
      }
      faceLoginBtn.disabled = true;
      setHint('loginHint', 'Memindai & mencocokkan wajah dengan model OpenCV backend...');
      try {
        const result = await api('/api/players/face-login', {
          method: 'POST',
          body: JSON.stringify({ image_base64: snapshot })
        });
        if (result.session && result.session.access_token) {
          saveToken(result.session.access_token);
        }
        setHint('loginHint', result.message || 'Login wajah berhasil!');
        await continueToTeam(getPlayer(result));
      } catch (error) {
        setHint('loginHint', error.message, true);
      } finally {
        faceLoginBtn.disabled = false;
      }
    });
  }

  const regBtn = $('registerBtn');
  if (regBtn) {
    regBtn.onclick = async () => {
      if (!authStream) await requestCameraAccess();
      const player_number = $('playerNumber') ? Number($('playerNumber').value) : NaN;
      const username = $('playerName') ? $('playerName').value.trim() : '';
      const full_name = $('fullName') ? $('fullName').value.trim() : '';
      const email = $('playerEmail') ? $('playerEmail').value.trim() : '';

      if (!Number.isInteger(player_number) || player_number < 1 || player_number > 999) {
        setHint('registerHint', 'Player ID wajib berupa angka 1 sampai 999.', true);
        return;
      }
      if (!username || !full_name) {
        setHint('registerHint', 'Username dan Nama Lengkap wajib diisi.', true);
        return;
      }
      const snapshot = captureWebcamFrameBase64();
      if (!snapshot) {
        setHint('registerHint', 'Kamera belum siap!', true);
        return;
      }

      regBtn.disabled = true;
      setHint('registerHint', 'Mengekstrak biometrik wajah & mendaftarkan akun...');
      try {
        await api('/api/players/register', {
          method: 'POST',
          body: JSON.stringify({
            player_number,
            username,
            full_name,
            email: email || undefined,
            image_base64: snapshot
          })
        });
        setHint('loginHint', 'Registrasi wajah berhasil! Silakan langsung login dengan wajah.');
        showAuth('login');
      } catch (error) {
        setHint('registerHint', error.message, true);
      } finally {
        regBtn.disabled = false;
      }
    };
  }
}

// ==========================================
// INITIALIZATION
// ==========================================

showAuth('login');
(async () => {
  try {
    await restorePortalSession();
  } catch (error) {
    console.error('Gagal memulihkan sesi Player Portal:', error);
    if (player) {
      match = null;
      window.currentPlayerTeam = null;
      await continueToTeam(player);
      setHint('roomListHint', 'Sesi login dipulihkan, tetapi room sebelumnya tidak dapat dimuat.', true);
    }
  }
})();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupFaceAuthEvents);
} else {
  setupFaceAuthEvents();
}