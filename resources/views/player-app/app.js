
// ==========================================
// OPERATION: SURABAYA
// PLAYER PORTAL - APP.JS
// ==========================================

const API_BASE = 'http://127.0.0.1:8000';

const $ = (id) => document.getElementById(id);

let player = null;
let match = null;
let pollHandle = null;
let accessToken = sessionStorage.getItem('access_token');

let cameraStream = null;
let gameplayOpened = false;
let healthPollHandle = null;
let playerEliminated = false;
let shootCooldown = false;

// ==========================================
// API CONFIGURATION
// ==========================================

async function api(path, options = {}) {
    const headers = {
        'Content-Type': 'application/json',
        ...(accessToken
            ? { Authorization: `Bearer ${accessToken}` }
            : {}),
        ...(options.headers || {})
    };

    const response = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers
    });

    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(
            body.detail || body.message || `HTTP ${response.status}`
        );
    }

    return body;
}

// ==========================================
// TOKEN MANAGEMENT
// ==========================================

function saveToken(token) {
    accessToken = token || null;

    if (accessToken) {
        sessionStorage.setItem('access_token', accessToken);
    } else {
        sessionStorage.removeItem('access_token');
    }
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
// CAMERA MANAGEMENT
// ==========================================

function stopGameplayCamera() {
    if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
        cameraStream = null;
    }

    const video = $('gameplayCamera');

    if (video) {
        video.srcObject = null;
    }
}

async function startGameplayCamera() {
    const video = $('gameplayCamera');
    const placeholder = $('cameraPlaceholder');
    const message = $('cameraMessage');
    const status = $('cameraStatus');

    if (!navigator.mediaDevices ||
        !navigator.mediaDevices.getUserMedia) {

        if (message) {
            message.textContent =
                'Browser tidak mendukung kamera atau halaman belum menggunakan HTTPS/localhost.';
        }

        if (status) {
            status.textContent = 'CAMERA UNAVAILABLE';
        }

        return;
    }

    try {
        if (status) status.textContent = 'REQUESTING CAMERA...';

        if (message) {
            message.textContent = 'Meminta izin akses kamera...';
        }

        stopGameplayCamera();

        cameraStream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
                facingMode: { ideal: 'environment' },
                width: { ideal: 1920 },
                height: { ideal: 1080 }
            }
        });

        if (video) {
            video.srcObject = cameraStream;
            await video.play();
        }

        if (placeholder) {
            placeholder.classList.add('hidden');
        }

        if (status) {
            status.textContent = 'CAMERA CONNECTED';
        }

        if (message) {
            message.textContent = 'Kamera berhasil diaktifkan.';
        }

    } catch (error) {
        console.error('Kamera gagal diaktifkan:', error);

        if (placeholder) {
            placeholder.classList.remove('hidden');
        }

        if (status) {
            status.textContent = 'CAMERA ERROR';
        }

        if (error.name === 'NotAllowedError' ||
            error.name === 'PermissionDeniedError') {

            if (message) {
                message.textContent =
                    'Izin kamera ditolak. Izinkan akses kamera melalui pengaturan browser.';
            }

        } else if (error.name === 'NotFoundError') {

            if (message) {
                message.textContent =
                    'Kamera tidak ditemukan pada perangkat ini.';
            }

        } else {

            if (message) {
                message.textContent =
                    'Kamera gagal diaktifkan. Pastikan halaman menggunakan HTTPS atau localhost.';
            }
        }
    }
}

// ==========================================
// GAMEPLAY SCREEN
// ==========================================

function openGameplay() {
    if (gameplayOpened) return;

    gameplayOpened = true;

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

    $('gameplayMatchName').textContent =
        match?.match_name || 'OPERATION: SURABAYA';

    $('gameplayPlayerInfo').textContent =
        `${player?.full_name || 'PLAYER'} · ${
            player?.username ? '@' + player.username : ''
        }`;

    const teamName = window.currentPlayerTeam || 'TEAM';

    $('gameplayTeamBadge').textContent = teamName;
    $('gameplayTeamBadge').className =
        `team-badge ${teamName.toLowerCase()}`;

    startGameplayCamera();
    startGameplayHealthPolling();
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

    $('authTitle').textContent = isLogin
        ? 'Player login'
        : 'Create player account';
}

$('showLogin').addEventListener('click', () => {
    showAuth('login');
});

$('showRegister').addEventListener('click', () => {
    showAuth('register');
});

// ==========================================
// PASSWORD VISIBILITY (Optional / Legacy)
// ==========================================

function togglePassword(inputId, button) {
    const input = $(inputId);
    if (!input) return;

    const isPassword = input.type === 'password';
    input.type = isPassword ? 'text' : 'password';
    button.textContent = isPassword ? 'HIDE' : 'SHOW';
}

if ($('toggleLoginPassword')) {
    $('toggleLoginPassword').addEventListener('click', event => {
        togglePassword('loginPassword', event.currentTarget);
    });
}

if ($('toggleRegisterPassword')) {
    $('toggleRegisterPassword').addEventListener('click', event => {
        togglePassword('registerPassword', event.currentTarget);
    });
}

// ==========================================
// CONTINUE AFTER LOGIN
// ==========================================

async function continueToTeam(profile) {
    if (!profile) {
        throw new Error(
            'Profil pemain tidak ditemukan dari respons backend.'
        );
    }

    player = profile;

    $('welcomeText').textContent =
        `Logged in as ${player.full_name} (@${player.username})`;

    $('loginPanel').classList.add('hidden');
    $('teamPanel').classList.remove('hidden');

    setHint(
        'teamHint',
        'Memeriksa pertandingan yang sedang menunggu...'
    );

    const waiting = await api('/api/matches/waiting');

    if (!waiting.data) {
        setHint(
            'teamHint',
            'Belum ada pertandingan waiting. Hubungi admin untuk membuat pertandingan.',
            true
        );

        document.querySelectorAll('[data-team]').forEach(button => {
            button.disabled = true;
        });

        return;
    }

    match = waiting.data;

    document.querySelectorAll('[data-team]').forEach(button => {
        button.disabled = false;
    });

    setHint(
        'teamHint',
        `${match.match_name} · ${match.arena_name} · Pilih tim untuk bergabung.`
    );
}

// ==========================================
// LEGACY LOGIN / REGISTER EVENT (SAFELY GUARDED)
// ==========================================

if ($('loginBtn')) {
    $('loginBtn').addEventListener('click', async () => {
        const emailInput = $('loginEmail');
        const passInput = $('loginPassword');
        const email = emailInput ? emailInput.value.trim() : '';
        const password = passInput ? passInput.value : '';

        if (!email || !password) {
            setHint('loginHint', 'Email dan password wajib diisi.', true);
            return;
        }

        $('loginBtn').disabled = true;
        setHint('loginHint', 'Memverifikasi akun...');

        try {
            const result = await api('/api/players/login', {
                method: 'POST',
                body: JSON.stringify({ email, password })
            });

            if (!result.access_token) {
                throw new Error('Backend tidak mengembalikan access token.');
            }

            saveToken(result.access_token);
            await continueToTeam(getPlayer(result));
        } catch (error) {
            saveToken(null);
            setHint('loginHint', error.message, true);
        } finally {
            $('loginBtn').disabled = false;
        }
    });
}

if ($('registerBtn') && $('registerPassword')) {
    // Only bind legacy password register if registerPassword exists in DOM
    $('registerBtn').addEventListener('click', async () => {
        const username = $('playerName') ? $('playerName').value.trim() : '';
        const full_name = $('fullName') ? $('fullName').value.trim() : '';
        const email = $('playerEmail') ? $('playerEmail').value.trim() : '';
        const password = $('registerPassword') ? $('registerPassword').value : '';

        if (!username || !full_name || !email || !password) {
            setHint('registerHint', 'Semua kolom wajib diisi.', true);
            return;
        }

        if (password.length < 8) {
            setHint('registerHint', 'Password minimal 8 karakter.', true);
            return;
        }

        $('registerBtn').disabled = true;
        setHint('registerHint', 'Membuat akun pemain...');

        try {
            const result = await api('/api/players/register', {
                method: 'POST',
                body: JSON.stringify({ username, full_name, email, password })
            });

            if (result.access_token) {
                saveToken(result.access_token);
                await continueToTeam(getPlayer(result));
            } else {
                if ($('loginEmail')) $('loginEmail').value = email;
                showAuth('login');
                setHint('loginHint', 'Registrasi berhasil. Silakan login.');
            }
        } catch (error) {
            setHint('registerHint', error.message, true);
        } finally {
            $('registerBtn').disabled = false;
        }
    });
}

// ==========================================
// TEAM SELECTION
// ==========================================

document.querySelectorAll('[data-team]').forEach(button => {
    button.addEventListener('click', async () => {
        if (!player || !match) return;

        const teamCode = button.dataset.team;

        button.disabled = true;

        setHint(
            'teamHint',
            `Menggabungkan pemain ke ${teamCode} TEAM...`
        );

        try {
            await api(`/api/matches/${match.id}/join`, {
                method: 'POST',
                body: JSON.stringify({
                    player_id: player.id,
                    team_code: teamCode
                })
            });

            $('assignment').textContent = `${teamCode} TEAM`;

            $('assignment').className =
                `assignment ${teamCode.toLowerCase()}`;

            $('lobbyWelcome').textContent =
                `${player.full_name} (@${player.username})`;

            $('lobbyPanel').classList.remove('hidden');
            $('teamPanel').classList.add('hidden');

            $('operationStatus').textContent = 'LOBBY';

            await refreshLobby();

            if (pollHandle) {
                clearInterval(pollHandle);
            }

            pollHandle = setInterval(refreshLobby, 3000);

        } catch (error) {
            setHint('teamHint', error.message, true);
            button.disabled = false;
        }
    });
});

// ==========================================
// RENDER TEAM PLAYERS
// ==========================================

function renderTeamPlayers(players, containerId) {
    const container = $(containerId);

    if (!container) return;

    container.innerHTML = '';

    if (!players || players.length === 0) {
        const row = document.createElement('tr');
        const cell = document.createElement('td');

        cell.colSpan = 3;
        cell.className = 'empty-team';
        cell.textContent = 'Belum ada pemain.';

        row.appendChild(cell);
        container.appendChild(row);

        return;
    }

    players.forEach((item, index) => {
        const p = item.player || {};

        const row = document.createElement('tr');

        const numberCell = document.createElement('td');

        numberCell.textContent =
            String(index + 1).padStart(2, '0');

        const nameCell = document.createElement('td');

        const name = document.createElement('strong');

        name.textContent =
            p.full_name || p.username || 'Unknown';

        const username = document.createElement('small');

        username.textContent = `@${p.username || '-'}`;

        nameCell.appendChild(name);
        nameCell.appendChild(document.createElement('br'));
        nameCell.appendChild(username);

        const statusCell = document.createElement('td');

        const status = document.createElement('span');

        status.className = 'table-player-status';

        status.textContent =
            (item.player_status || 'JOINED').toUpperCase();

        statusCell.appendChild(status);

        row.append(numberCell, nameCell, statusCell);

        container.appendChild(row);
    });
}

// ==========================================
// REFRESH WAITING LOBBY
// ==========================================

async function refreshLobby() {
    if (!match || !player) return;

    try {
        const result = await api(
            `/api/matches/${match.id}/lobby`
        );

        const lobby = result.lobby;

        console.log('DATA RED TEAM:', lobby.red_team);
        console.log('DATA BLUE TEAM:', lobby.blue_team);

        renderTeamPlayers(
            lobby.red_team.players,
            'redTeamPlayers'
        );

        renderTeamPlayers(
            lobby.blue_team.players,
            'blueTeamPlayers'
        );

        $('redTeamCount').textContent =
            `${lobby.red_team.total} PLAYERS`;

        $('blueTeamCount').textContent =
            `${lobby.blue_team.total} PLAYERS`;

        const playerInRed = lobby.red_team.players.some(
            item => item.player.id === player.id
        );

        const playerInBlue = lobby.blue_team.players.some(
            item => item.player.id === player.id
        );

        const team = playerInRed
            ? 'RED'
            : playerInBlue
                ? 'BLUE'
                : 'UNKNOWN';

        $('assignment').textContent =
            team === 'UNKNOWN'
                ? 'NOT ASSIGNED'
                : `${team} TEAM`;

        $('assignment').className =
            `assignment ${team.toLowerCase()}`;

        $('lobbyState').textContent =
            result.match.status.toUpperCase();

        $('operationStatus').textContent =
            result.match.status.toUpperCase();

        window.currentPlayerTeam = playerInRed
            ? 'RED'
            : playerInBlue
                ? 'BLUE'
                : 'TEAM';

        if (
            result.match.status === 'active' &&
            (playerInRed || playerInBlue)
        ) {
            openGameplay();
            return;
        }

        const note = result.match.status === 'active'
            ? 'Pertandingan telah dimulai. Ikuti instruksi admin.'
            : result.match.status === 'completed'
                ? 'Pertandingan telah berakhir.'
                : 'Menunggu admin memulai pertandingan.';

        const statusEl =
            document.querySelector('.lobby-status small');

        if (statusEl) {
            statusEl.textContent =
                `${note} (${lobby.total_players}/${lobby.max_players} pemain)`;
        }

    } catch (error) {
        console.error('Gagal memperbarui lobby:', error);
    }
}

// ==========================================
// GAMEPLAY HEALTH SYSTEM
// ==========================================

function showEliminatedScreen() {
    if (playerEliminated) return;

    playerEliminated = true;

    const overlay = $('eliminatedOverlay');

    if (overlay) {
        overlay.classList.remove('hidden');
    }

    const shootButton = $('shootBtn');

    if (shootButton) {
        shootButton.disabled = true;

        const shootLabel =
            shootButton.querySelector('.shoot-label');

        if (shootLabel) {
            shootLabel.textContent = 'ELIMINATED';
        }
    }
}

async function refreshGameplayHealth() {
    if (!player || !match || !gameplayOpened) return;

    try {
        const result = await api(
            `/api/matches/${match.id}/health`
        );

        const health = (result.players || []).find(
            item => item.player_id === player.id
        );

        if (!health) {
            console.warn('Data health pemain tidak ditemukan.');
            return;
        }

        const hp = Number(health.current_health);
        const maxHp = Number(health.max_health);

        const percentage = maxHp > 0
            ? Math.max(0, Math.min(100, (hp / maxHp) * 100))
            : 0;

        const fill = $('gameplayHealthFill');
        const text = $('gameplayHealthText');
        const status = $('gameplayHealthStatus');

        if (text) {
            text.textContent = `${hp} / ${maxHp} HP`;
        }

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
    if (healthPollHandle) {
        clearInterval(healthPollHandle);
    }

    refreshGameplayHealth();

    healthPollHandle = setInterval(
        refreshGameplayHealth,
        2000
    );
}

function stopGameplayHealthPolling() {
    if (healthPollHandle) {
        clearInterval(healthPollHandle);
        healthPollHandle = null;
    }
}

// ==========================================
// GAMEPLAY SHOOT ACTION
// ==========================================

async function sendShootEvent() {
    const button = $('shootBtn');

    if (
        !player ||
        !match ||
        playerEliminated ||
        shootCooldown ||
        !button ||
        button.disabled
    ) {
        return;
    }

    shootCooldown = true;
    button.disabled = true;

    const shootLabel =
        button.querySelector('.shoot-label');

    if (shootLabel) {
        shootLabel.textContent = 'SENDING...';
    }

    try {
        const result = await api(
            `/api/matches/${match.id}/shoot`,
            {
                method: 'POST',
                body: JSON.stringify({
                    player_id: player.id
                })
            }
        );

        console.log('Shoot berhasil:', result);

        if (shootLabel) {
            shootLabel.textContent = 'SHOT SENT';
        }

    } catch (error) {
        console.error('Shoot gagal:', error);

        if (shootLabel) {
            shootLabel.textContent = 'FAILED';
        }

        // Tampilkan pesan error di Console
        // agar penyebabnya mudah diperiksa.
    } finally {
        setTimeout(() => {
            shootCooldown = false;

            if (!playerEliminated && button) {
                button.disabled = false;

                if (shootLabel) {
                    shootLabel.textContent = 'FIRE';
                }
            }
        }, 500);
    }
}

// ==========================================
// GAMEPLAY CAMERA CONTROLS
// ==========================================

$('enableCameraBtn').addEventListener(
    'click',
    startGameplayCamera
);

$('shootBtn').addEventListener(
    'click',
    sendShootEvent
);

// ==========================================
// GAMEPLAY LOGOUT
// ==========================================

$('gameplayLogoutBtn').addEventListener('click', async () => {
    try {
        if (accessToken) {
            await api('/api/players/logout', {
                method: 'POST',
                body: JSON.stringify({
                    access_token: accessToken
                })
            });
        }

        stopGameplayCamera();

        gameplayOpened = false;

        resetPortal('Logout berhasil. Silakan login kembali.');

    } catch (error) {
        $('cameraMessage').textContent = error.message;
    }
});

// ==========================================
// LOGOUT
// ==========================================

$('leaveBtn').addEventListener('click', async () => {
    const button = $('leaveBtn');

    button.disabled = true;
    button.textContent = 'LOGGING OUT...';

    try {
        if (accessToken) {
            await api('/api/players/logout', {
                method: 'POST',
                body: JSON.stringify({
                    access_token: accessToken
                })
            });
        }

        resetPortal('Logout berhasil. Silakan login kembali.');

    } catch (error) {
        setHint('lobbyHint', error.message, true);

    } finally {
        button.disabled = false;
        button.textContent = 'LOG OUT';
    }
});

// ==========================================
// LEAVE TEAM
// ==========================================

$('leaveTeamBtn').addEventListener('click', async () => {
    if (!player || !match) return;

    const button = $('leaveTeamBtn');

    button.disabled = true;
    button.textContent = 'LEAVING TEAM...';

    try {
        if (pollHandle) {
            clearInterval(pollHandle);
            pollHandle = null;
        }

        await api(`/api/matches/${match.id}/leave`, {
            method: 'POST',
            body: JSON.stringify({
                player_id: player.id
            })
        });

        $('lobbyPanel').classList.add('hidden');
        $('teamPanel').classList.remove('hidden');

        document.querySelectorAll('[data-team]').forEach(btn => {
            btn.disabled = false;
        });

        $('operationStatus').textContent = 'TEAM SELECTION';

        setHint(
            'teamHint',
            'Berhasil keluar dari tim. Silakan pilih tim kembali.'
        );

    } catch (error) {
        setHint('lobbyHint', error.message, true);

        pollHandle = setInterval(refreshLobby, 3000);

    } finally {
        button.disabled = false;
        button.textContent = 'LEAVE TEAM';
    }
});

// ==========================================
// RESET PLAYER PORTAL
// ==========================================

function resetPortal(message) {
    if (pollHandle) {
        clearInterval(pollHandle);
    }

    stopGameplayCamera();
    stopGameplayHealthPolling();

    gameplayOpened = false;
    shootCooldown = false;

    // Reset eliminated state
    playerEliminated = false;

    const overlay = $('eliminatedOverlay');

    if (overlay) {
        overlay.classList.add('hidden');
    }

    const shootButton = $('shootBtn');

    if (shootButton) {
        shootButton.disabled = false;

        const shootLabel =
            shootButton.querySelector('.shoot-label');

        if (shootLabel) {
            shootLabel.textContent = 'FIRE';
        }
    }

    $('gameplayPanel').classList.add('hidden');

    pollHandle = null;

    player = null;
    match = null;

    window.currentPlayerTeam = null;

    saveToken(null);

    $('lobbyPanel').classList.add('hidden');
    $('teamPanel').classList.add('hidden');
    $('loginPanel').classList.remove('hidden');

    if ($('loginEmail')) $('loginEmail').value = '';
    if ($('loginPassword')) $('loginPassword').value = '';

    if ($('playerName')) $('playerName').value = '';
    if ($('fullName')) $('fullName').value = '';
    if ($('playerEmail')) $('playerEmail').value = '';
    if ($('registerPassword')) $('registerPassword').value = '';

    $('operationStatus').textContent = 'STANDBY';

    showAuth('login');

    setHint('loginHint', message);
}

// ==========================================
// INITIALIZATION
// ==========================================

showAuth('login');

console.log('OPERATION: SURABAYA Player Portal initialized.');



// ==========================================

// ==========================================


// ==========================================


// ==========================================
// FACE RECOGNITION BIOMETRIC SYSTEM (OPENCV BACKEND INTEGRATION)
// ==========================================

let authStream = null;
let isWebcamReady = false;
let faceTrackerHandle = null;
let isFaceApiLoaded = false;

// Muat model face-api untuk visual face box tracking di browser
async function loadFaceTrackerModels() {
    if (typeof faceapi === 'undefined' || isFaceApiLoaded) return;
    try {
        await faceapi.nets.ssdMobilenetv1.loadFromUri('models');
        isFaceApiLoaded = true;
        console.log('[FACE-API] SSD Mobilenet model loaded for live tracking.');
    } catch (e) {
        console.warn('[FACE-API] Tidak dapat memuat model lokal untuk tracking visual:', e);
    }
}

function startFaceTracking() {
    const video = $('authWebcam');
    const overlay = $('authOverlay');
    const badge = $('faceBadge');
    if (!video || !overlay) return;

    if (faceTrackerHandle) {
        clearInterval(faceTrackerHandle);
        faceTrackerHandle = null;
    }

    const ctx = overlay.getContext('2d');

    faceTrackerHandle = setInterval(async () => {
        if (!authStream || video.paused || video.ended || video.videoWidth === 0) {
            return;
        }

        // Sesuaikan ukuran overlay canvas dengan ukuran frame video asli
        if (overlay.width !== video.videoWidth || overlay.height !== video.videoHeight) {
            overlay.width = video.videoWidth;
            overlay.height = video.videoHeight;
        }

        ctx.clearRect(0, 0, overlay.width, overlay.height);

        // Jika model face-api tersedia, deteksi wajah dan gambar bounding box dinamis
        if (typeof faceapi !== 'undefined' && isFaceApiLoaded) {
            try {
                const detection = await faceapi.detectSingleFace(video);
                if (detection && detection.box) {
                    const { x, y, width, height } = detection.box;

                    // Flip koordinat X agar sinkron dengan video yang di-mirror CSS (scaleX(-1))
                    // Canvas TIDAK di-mirror CSS, jadi kita flip manual di sini
                    const mirX = overlay.width - x - width;
                    
                    // Gambar kotak wajah hijau neon beranimasi
                    ctx.save();
                    ctx.strokeStyle = '#00ff88';
                    ctx.lineWidth = 3;
                    ctx.shadowColor = '#00ff88';
                    ctx.shadowBlur = 10;
                    
                    // Sudut-sudut kotak target (koordinat sudah di-flip)
                    const len = Math.min(width, height) * 0.25;
                    // Top-Left
                    ctx.beginPath();
                    ctx.moveTo(mirX, y + len); ctx.lineTo(mirX, y); ctx.lineTo(mirX + len, y);
                    ctx.stroke();
                    // Top-Right
                    ctx.beginPath();
                    ctx.moveTo(mirX + width - len, y); ctx.lineTo(mirX + width, y); ctx.lineTo(mirX + width, y + len);
                    ctx.stroke();
                    // Bottom-Right
                    ctx.beginPath();
                    ctx.moveTo(mirX + width, y + height - len); ctx.lineTo(mirX + width, y + height); ctx.lineTo(mirX + width - len, y + height);
                    ctx.stroke();
                    // Bottom-Left
                    ctx.beginPath();
                    ctx.moveTo(mirX + len, y + height); ctx.lineTo(mirX, y + height); ctx.lineTo(mirX, y + height - len);
                    ctx.stroke();

                    // Label status di atas kotak wajah — canvas tidak di-mirror CSS, text langsung terbaca
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
                } else {
                    if (badge) {
                        badge.textContent = 'MENCARI WAJAH...';
                        badge.className = 'face-status-badge scanning';
                    }
                }
            } catch (err) {
                // Abaikan kesalahan frame sementara
            }
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

    if (!webcam) {
        console.warn('Elemen authWebcam tidak ditemukan!');
        return;
    }

    if (badge) badge.textContent = 'MEMINTA IZIN KAMERA...';
    if (instruction) instruction.textContent = 'Izinkan akses kamera pada pop-up browser (Allow).';

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        const errorMsg = 'Browser tidak mendukung getUserMedia atau halaman dibuka tanpa localhost/HTTPS.';
        if (badge) {
            badge.textContent = 'KAMERA TIDAK DIDUKUNG';
            badge.className = 'face-status-badge scanning';
        }
        if (instruction) {
            instruction.textContent = errorMsg;
        }
        alert(errorMsg);
        return;
    }

    try {
        console.log('[CAMERA] Memanggil navigator.mediaDevices.getUserMedia...');
        // 1. Minta akses kamera laptop langsung
        authStream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false
        });

        console.log('[CAMERA] Akses kamera didapatkan:', authStream);
        webcam.srcObject = authStream;
        isWebcamReady = true;

        if (promptBox) promptBox.classList.add('hidden');

        try {
            await webcam.play();
        } catch (playErr) {
            console.warn('Autoplay error:', playErr);
        }

        if (badge) {
            badge.textContent = 'KAMERA AKTIF · SIAP PINDAI';
            badge.className = 'face-status-badge success';
        }
        if (instruction) {
            instruction.textContent = 'Arahkan wajah Anda ke kamera lalu tekan tombol Scan Wajah / Daftar.';
        }

        const bioStatus = $('faceSampleStatus');
        if (bioStatus) bioStatus.textContent = '✓ Sensor kamera siap menangkap wajah';
        const bioInd = $('bioIndicator');
        if (bioInd) bioInd.classList.add('ready');

        // Mulai pemuatan model dan pelacakan kotak wajah
        loadFaceTrackerModels().then(() => {
            startFaceTracking();
        });

    } catch (err) {
        console.error('[CAMERA ERROR]:', err);
        isWebcamReady = false;
        if (promptBox) promptBox.classList.remove('hidden');
        if (badge) {
            badge.textContent = 'IZIN KAMERA DITOLAK / GAGAL';
            badge.className = 'face-status-badge scanning';
        }

        let detailMsg = err.name + ': ' + err.message;
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
            detailMsg = 'Izin kamera diblokir browser. Klik ikon gembok/kamera di address bar untuk mengizinkan (Allow), lalu refresh.';
        } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
            detailMsg = 'Perangkat kamera/webcam tidak terdeteksi di laptop/PC.';
        } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
            detailMsg = 'Kamera sedang digunakan oleh aplikasi lain (misal Zoom/Teams/aplikasi OpenCV python). Tutup aplikasi lain terlebih dahulu.';
        }

        if (instruction) {
            instruction.textContent = detailMsg;
        }
    }
}

function setupFaceAuthEvents() {
    // 1. Langsung picu akses kamera saat halaman dibuka
    requestCameraAccess();

    // 2. Tombol izin manual jika browser menolak autoplay
    const reqCamBtn = $('requestCameraBtn');
    if (reqCamBtn) {
        reqCamBtn.addEventListener('click', (e) => {
            e.preventDefault();
            requestCameraAccess();
        });
    }

    // 3. Face Login Button (Snapshot Dikirim ke Python Backend OpenCV)
    const faceLoginBtn = $('faceLoginBtn');
    if (faceLoginBtn) {
        faceLoginBtn.addEventListener('click', async () => {
            if (!authStream) {
                await requestCameraAccess();
            }

            const snapshot = captureWebcamFrameBase64();
            if (!snapshot) {
                setHint('loginHint', 'Kamera belum siap atau belum aktif. Pastikan izin kamera sudah diberikan.', true);
                return;
            }

            faceLoginBtn.disabled = true;
            setHint('loginHint', 'Memindai & mencocokkan wajah dengan model OpenCV backend...');

            try {
                const result = await api('/api/players/face-login', {
                    method: 'POST',
                    body: JSON.stringify({
                        image_base64: snapshot
                    })
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

    // 4. Face Registration Button (Snapshot Gambar Dikirim ke Python Backend OpenCV)
    const regBtn = $('registerBtn');
    if (regBtn) {
        regBtn.onclick = async () => {
            if (!authStream) {
                await requestCameraAccess();
            }

            const username = $('playerName') ? $('playerName').value.trim() : '';
            const full_name = $('fullName') ? $('fullName').value.trim() : '';
            const email = $('playerEmail') ? $('playerEmail').value.trim() : '';

            if (!username || !full_name) {
                setHint('registerHint', 'Username dan Nama Lengkap wajib diisi.', true);
                return;
            }

            const snapshot = captureWebcamFrameBase64();
            if (!snapshot) {
                setHint('registerHint', 'Kamera belum siap! Pastikan webcam aktif dan wajah Anda menghadap kamera.', true);
                return;
            }

            regBtn.disabled = true;
            setHint('registerHint', 'Mengekstrak biometrik wajah & mendaftarkan akun...');

            try {
                const result = await api('/api/players/register', {
                    method: 'POST',
                    body: JSON.stringify({
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

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupFaceAuthEvents);
} else {
    setupFaceAuthEvents();
}
