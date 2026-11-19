
// ==========================================
// OPERATION: SURABAYA
// PLAYER PORTAL - APP.JS
// ==========================================

const API_BASE = 'http://127.0.0.1:8000';

const $ = (id) => document.getElementById(id);

let player = null;
let match = null;
let roomsCache = [];
let pollHandle = null;
let accessToken = sessionStorage.getItem('access_token');

let cameraStream = null;
let gameplayOpened = false;
let healthPollHandle = null;
let playerEliminated = false;
let shootCooldown = false;
let timerTickHandle = null;
let timerSyncHandle = null;
let matchEndsAt = null;
let timerExpiredHandled = false;
let weaponQrScanActive = false;
let weaponQrScanFrame = null;
let weaponQrScanner = null;
let weaponQrBusy = false;
let weaponQrRestartGameplayCamera = false;
let ghostQrScanner = null;
let ghostQrBusy = false;
let ghostQrRestartGameplayCamera = false;
let ghostModeUntil = null;
let ghostModeTickHandle = null;

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
    startBaseShutdownNotificationPolling();

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
    if (!profile) throw new Error('Profil pemain tidak ditemukan dari respons backend.');
    player = profile;
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
        meta.textContent = `${room.arena_name || 'Arena'} · ${room.duration_hours ?? '-'} jam · ${String(room.status || '').toUpperCase()}`;
        const teams = document.createElement('div');
        teams.className = 'room-team-capacity';
        const red = document.createElement('span');
        red.className = 'red-text';
        red.textContent = `RED ${room.red_team?.total ?? 0}/${room.red_team?.capacity ?? 0}`;
        const blue = document.createElement('span');
        blue.className = 'blue-text';
        blue.textContent = `BLUE ${room.blue_team?.total ?? 0}/${room.blue_team?.capacity ?? 0}`;
        teams.append(red, blue);
        const controls = document.createElement('div');
        controls.className = 'room-card-controls';
        const select = document.createElement('select');
        select.innerHTML = '<option value="RED">JOIN RED</option><option value="BLUE">JOIN BLUE</option>';
        const join = document.createElement('button');
        join.type = 'button'; join.className = 'btn primary'; join.textContent = 'JOIN';
        join.addEventListener('click', () => joinRoom(room.room_code, select.value));
        controls.append(select, join);
        card.append(title, meta, teams, controls);
        container.appendChild(card);
    });
}

function enterLobby(room, teamCode) {
    match = {
        ...room,
        red_capacity: room.red_capacity ?? room.red_team?.capacity,
        blue_capacity: room.blue_capacity ?? room.blue_team?.capacity
    };
    window.currentPlayerTeam = teamCode;
    $('lobbyRoomCode').textContent = room.room_code || 'ROOM CODE UNAVAILABLE';
    $('assignment').textContent = `${teamCode} TEAM`;
    $('assignment').className = `assignment ${teamCode.toLowerCase()}`;
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
            body: JSON.stringify({ room_code: roomCode.trim().toUpperCase(), player_id: player.id, team_code: teamCode })
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
    const payload = {
        match_name: $('createRoomName').value.trim(),
        host_player_id: player.id,
        team_code: $('hostTeam').value,
        red_capacity: Number($('redCapacity').value),
        blue_capacity: Number($('blueCapacity').value),
        duration_hours: Number($('roomDuration').value),
        arena_name: $('roomArena').value.trim()
    };
    if (!payload.match_name || !payload.arena_name) {
        showRoomHint('createRoomHint', 'Nama room dan arena wajib diisi.', true); return;
    }
    if (!Number.isInteger(payload.red_capacity) || !Number.isInteger(payload.blue_capacity) || payload.red_capacity < 1 || payload.blue_capacity < 1 || payload.red_capacity > 50 || payload.blue_capacity > 50 || !Number.isFinite(payload.duration_hours) || payload.duration_hours <= 0 || payload.duration_hours > 24) {
        showRoomHint('createRoomHint', 'Periksa kapasitas tim (1–50) dan durasi (maksimal 24 jam).', true); return;
    }
    const button = $('createRoomBtn'); button.disabled = true;
    showRoomHint('createRoomHint', 'Membuat room...');
    try {
        const result = await api('/api/rooms/create', { method: 'POST', body: JSON.stringify(payload) });
        showRoomHint('createRoomHint', `Room dibuat. Kode: ${result.room.room_code}`);
        enterLobby(result.room, payload.team_code);
    } catch (error) {
        showRoomHint('createRoomHint', error.message, true);
    } finally { button.disabled = false; }
});

$('joinRoomBtn').addEventListener('click', () => {
    const code = $('joinRoomCode').value.trim().toUpperCase();
    if (!/^[A-Z0-9]{8}$/.test(code)) {
        showRoomHint('joinRoomHint', 'Kode room harus terdiri dari 8 karakter.', true); return;
    }
    joinRoom(code, $('joinTeam').value);
});
$('refreshRoomsBtn').addEventListener('click', () => loadRooms());
$('roomLogoutBtn').addEventListener('click', async () => {
    try {
        if (accessToken) await api('/api/players/logout', { method: 'POST', body: JSON.stringify({ access_token: accessToken }) });
    } catch (error) { console.warn('Logout API:', error); }
    resetPortal('Logout berhasil. Silakan login kembali.');
});

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
        match = { ...match, ...result.match };

        // Keep room and team identifiers visible in the waiting room.
        $('lobbyRoomCode').textContent =
            result.match.room_code || match.room_code || 'ROOM CODE UNAVAILABLE';

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
            `${lobby.red_team.total} / ${match.red_capacity ?? lobby.red_team.total} PLAYERS`;

        $('blueTeamCount').textContent =
            `${lobby.blue_team.total} / ${match.blue_capacity ?? lobby.blue_team.total} PLAYERS`;

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
// GAMEPLAY MATCH TIMER
// ==========================================

function formatMatchTime(totalSeconds) {
    const safe = Math.max(0, Math.floor(totalSeconds));
    const hours = Math.floor(safe / 3600);
    const minutes = Math.floor((safe % 3600) / 60);
    const seconds = safe % 60;
    return [hours, minutes, seconds]
        .map(value => String(value).padStart(2, '0'))
        .join(':');
}

function renderMatchTimer() {
    const timer = $('gameplayTimer');
    const status = $('gameplayTimerStatus');
    const card = timer?.closest('.match-timer-card');
    if (!timer || !matchEndsAt) return;

    const remaining = Math.max(0, Math.ceil((matchEndsAt - Date.now()) / 1000));
    timer.textContent = formatMatchTime(remaining);
    card?.classList.toggle('warning', remaining > 0 && remaining <= 300);

    if (remaining <= 0) {
        timer.textContent = '00:00:00';
        card?.classList.add('expired');
        if (status) status.textContent = 'TIME EXPIRED';
        $('gameplayStatus').textContent = 'COMPLETED';
        $('operationStatus').textContent = 'COMPLETED';
        if (!timerExpiredHandled) {
            timerExpiredHandled = true;
            stopGameplayTimer();
            stopGameplayCamera();
            stopGameplayHealthPolling();
            if (status) status.textContent = 'MATCH COMPLETED';
            alert('Waktu pertandingan telah habis. Pertandingan selesai.');
        }
    } else if (status) {
        status.textContent = remaining <= 300 ? 'FINAL COUNTDOWN' : 'MATCH IN PROGRESS';
    }
}

async function syncGameplayTimer() {
    if (!match || !gameplayOpened) return;
    try {
        const result = await api(`/api/matches/${match.id}/timer`);
        if (result.ends_at) matchEndsAt = new Date(result.ends_at).getTime();
        if (result.status === 'completed') {
            matchEndsAt = Math.min(matchEndsAt || Date.now(), Date.now());
        }
        renderMatchTimer();
    } catch (error) {
        console.error('Gagal sinkronisasi match timer:', error);
        if ($('gameplayTimerStatus')) $('gameplayTimerStatus').textContent = 'SYNC RETRY';
    }
}

function startGameplayTimer() {
    stopGameplayTimer();
    timerExpiredHandled = false;
    const startedAt = match?.started_at ? new Date(match.started_at).getTime() : NaN;
    const durationHours = Number(match?.duration_hours);
    if (Number.isFinite(startedAt) && Number.isFinite(durationHours) && durationHours > 0) {
        matchEndsAt = startedAt + durationHours * 3600000;
    } else {
        matchEndsAt = null;
        $('gameplayTimer').textContent = '--:--:--';
        $('gameplayTimerStatus').textContent = 'TIME NOT SET';
    }
    syncGameplayTimer();
    timerTickHandle = setInterval(renderMatchTimer, 1000);
    timerSyncHandle = setInterval(syncGameplayTimer, 10000);
}

function stopGameplayTimer() {
    if (timerTickHandle) clearInterval(timerTickHandle);
    if (timerSyncHandle) clearInterval(timerSyncHandle);
    timerTickHandle = null;
    timerSyncHandle = null;
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

        renderGhostMode(health.ghost_mode_until);

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
// GAMEPLAY WEAPON HUD
// ==========================================

async function refreshGameplayWeapon() {
    if (!player || !match || !gameplayOpened) return;
    try {
        const result = await api(
            `/api/matches/${match.id}/weapon/${player.id}`
        );
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
    if (button) { button.disabled = false; button.innerHTML = 'SCAN QR<br>UPGRADE'; }
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
        // Release gameplay camera first; some mobile devices allow only one active camera stream.
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
        if (button) { button.disabled = false; button.innerHTML = 'CANCEL<br>SCAN'; }
        setWeaponQrModalStatus('Kamera aktif. Arahkan ke QR Code stasiun upgrade.');
    } catch (error) {
        console.warn('Camera QR scanner error:', error);
        setWeaponQrModalStatus('Kamera tidak dapat dibuka. Coba pilih gambar QR dari galeri.', true);
        if (button) { button.disabled = false; button.innerHTML = 'SCAN QR<br>UPGRADE'; }
        // Keep modal open so file-based QR scanning remains available.
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
        try { const state = scanner.getState ? scanner.getState() : null; if (state === 2 || state === 1) await scanner.stop(); } catch (error) { console.warn('Ghost QR scanner stop:', error); }
        try { scanner.clear(); } catch (_) {}
    }
    $('ghostQrModal')?.classList.add('hidden');
    const button = $('scanGhostQrBtn');
    if (button) { button.disabled = false; button.innerHTML = 'CLAIM<br>GHOST'; }
    if (restartGameplay && ghostQrRestartGameplayCamera && gameplayOpened && !playerEliminated) {
        ghostQrRestartGameplayCamera = false;
        try { await startGameplayCamera(); } catch (error) { console.warn('Gameplay camera restart:', error); }
    } else { ghostQrRestartGameplayCamera = false; }
}

async function processGhostQrPayload(qrPayload) {
    if (!player || !match || ghostQrBusy) return;
    ghostQrBusy = true;
    $('ghostQrModalStatus').textContent = 'QR terbaca. Memvalidasi treasure...';
    try {
        const result = await api(`/api/matches/${match.id}/ghost-mode/scan`, {
            method: 'POST', body: JSON.stringify({ player_id: player.id, qr_payload: qrPayload })
        });
        $('ghostQrModalStatus').textContent = result.message || 'Ghost Mode berhasil diaktifkan.';
        renderGhostMode(result.ghost_mode_until);
        setTimeout(() => stopGhostQrScanner(true), 1200);
    } catch (error) {
        $('ghostQrModalStatus').textContent = error.message || 'QR tidak dapat diproses.';
        $('ghostQrModalStatus').style.color = '#ff858a';
        await stopGhostQrScanner(true);
    } finally { ghostQrBusy = false; }
}

async function startGhostQrScanner() {
    if (!gameplayOpened || !player || !match || playerEliminated) return;
    if (ghostQrScanner) { await stopGhostQrScanner(true); return; }
    if (typeof Html5Qrcode === 'undefined') { alert('Library QR scanner belum dimuat. Periksa koneksi internet.'); return; }
    $('ghostQrModal').classList.remove('hidden');
    $('ghostQrModalStatus').textContent = 'Meminta izin kamera...';
    const button = $('scanGhostQrBtn');
    if (button) { button.disabled = true; button.textContent = 'OPENING...'; }
    try {
        ghostQrRestartGameplayCamera = !!cameraStream;
        if (cameraStream) stopGameplayCamera();
        ghostQrScanner = new Html5Qrcode('ghostQrReader', { verbose: false, formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE] });
        await ghostQrScanner.start({ facingMode: 'environment' }, { fps: 10, qrbox: (w, h) => { const size = Math.max(160, Math.min(260, Math.floor(Math.min(w, h) * .72))); return { width: size, height: size }; }, aspectRatio: 1 }, async decoded => { if (!ghostQrBusy) await processGhostQrPayload(decoded); }, () => {});
        if (button) { button.disabled = false; button.innerHTML = 'CANCEL<br>SCAN'; }
        $('ghostQrModalStatus').textContent = 'Kamera aktif. Arahkan ke QR Treasure Ghost Mode.';
    } catch (error) {
        console.warn('Ghost QR camera error:', error);
        $('ghostQrModalStatus').textContent = 'Kamera tidak dapat dibuka. Pilih gambar QR dari galeri.';
        $('ghostQrModalStatus').style.color = '#ff858a';
        if (button) { button.disabled = false; button.innerHTML = 'CLAIM<br>GHOST'; }
    }
}

async function scanGhostQrImage(file) {
    if (!file || !player || !match || typeof Html5Qrcode === 'undefined') return;
    $('ghostQrModalStatus').textContent = 'Membaca gambar QR...';
    const scanner = new Html5Qrcode('ghostQrReader', { verbose: false });
    try { const decoded = await scanner.scanFile(file, true); await processGhostQrPayload(decoded); }
    catch (error) { $('ghostQrModalStatus').textContent = 'QR tidak ditemukan pada gambar. Coba gambar yang lebih jelas.'; $('ghostQrModalStatus').style.color = '#ff858a'; }
    finally { try { scanner.clear(); } catch (_) {} $('ghostQrFile').value = ''; }
}


// ==========================================
// BASE HEALING: QR + EXISTING POSE DETECTOR BRIDGE
// Pose detector integration contract: dispatch `ops-healing-pose-valid` with
// detail.valid=true while the configured healing pose is continuously held.
// Dispatch detail.valid=false (or stop dispatching) when pose is lost.
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
        healingQrScanner = new Html5Qrcode('healingQrReader', { verbose:false, formatsToSupport:[Html5QrcodeSupportedFormats.QR_CODE] });
        await healingQrScanner.start({facingMode:'environment'}, {fps:10, qrbox:(w,h)=>{const z=Math.max(160,Math.min(260,Math.floor(Math.min(w,h)*.72)));return {width:z,height:z};}, aspectRatio:1}, async decoded=>{ if (!healingQrBusy) { const activeScanner=healingQrScanner; healingQrScanner=null; try { await activeScanner.stop(); } catch (_) {} try { activeScanner.clear(); } catch (_) {} $('healingQrModal')?.classList.remove('hidden'); healingStationPayload=decoded; await processHealingQrPayload(decoded); } }, ()=>{});
        setHealingStatus('Kamera aktif. Scan QR yang terpasang di base tim kamu.');
    } catch (e) { setHealingStatus('Kamera tidak tersedia. Pilih gambar QR dari galeri.', true); }
}
async function scanHealingQrImage(file) {
    if (!file || typeof Html5Qrcode === 'undefined') return;
    const scanner = new Html5Qrcode('healingQrReader', {verbose:false});
    try { const decoded = await scanner.scanFile(file, true); await processHealingQrPayload(decoded); }
    catch (_) { setHealingStatus('QR tidak ditemukan pada gambar.', true); }
    finally { try { scanner.clear(); } catch (_) {} $('healingQrFile').value=''; }
}
async function completeHealingFromPose() {
    if (healingCompleteBusy || !healingStationPayload || !player || !match) return;
    healingCompleteBusy = true;
    setHealingPoseStatus('Pose valid. Memproses healing...');
    try {
        const result = await api(`/api/matches/${match.id}/heal`, {method:'POST', body:JSON.stringify({player_id:player.id, qr_payload:healingStationPayload, pose_verified:true})});
        setHealingPoseStatus(result.message || 'Healing berhasil.');
        setHealingStatus(`HP sekarang ${result.current_health}/${result.max_health}.`);
        await refreshGameplayHealth();
        setTimeout(()=>stopHealingQrScanner(true), 1500);
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
    healingPoseTimer = setInterval(()=>{
        if (!healingPoseValid) return;
        const elapsed = (Date.now()-healingPoseStartedAt)/1000;
        const pct = Math.min(100, elapsed/HEALING_POSE_HOLD_SECONDS*100);
        if ($('healingProgressFill')) $('healingProgressFill').style.width = `${pct}%`;
        const left = Math.max(0, Math.ceil(HEALING_POSE_HOLD_SECONDS-elapsed));
        if ($('healingCountdown')) $('healingCountdown').textContent = `PERTAHANKAN POSE · ${left} DETIK`;
        if (elapsed >= HEALING_POSE_HOLD_SECONDS) { clearInterval(healingPoseTimer); healingPoseTimer=null; completeHealingFromPose(); }
    },100);
}
window.addEventListener('ops-healing-pose-valid', handleHealingPoseSignal);

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
            shootLabel.textContent = `SHOT · ${result.weapon_damage ?? 10} DMG`;
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
// ==========================================
// BASE SHUTDOWN QR
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

function setBaseShutdownStatus(message, isError=false){const el=$('baseShutdownStatus');if(el){el.textContent=message;el.style.color=isError?'#ff858a':'';}}
async function stopBaseShutdownScanner(restartGameplay=true){
  if(baseShutdownTimer){clearInterval(baseShutdownTimer);baseShutdownTimer=null;}
  const scanner=baseShutdownScanner;baseShutdownScanner=null;
  if(scanner){try{const state=scanner.getState?.();if(state===2||state===1)await scanner.stop();}catch(e){console.warn('Base shutdown scanner stop:',e);}try{scanner.clear();}catch(_){}}
  $('baseShutdownModal')?.classList.add('hidden');$('baseShutdownCountdown')?.classList.add('hidden');
  const button=$('scanBaseShutdownBtn');if(button){button.disabled=false;button.innerHTML='<span>04</span> SHUTDOWN BASE';}
  if(restartGameplay&&baseShutdownRestartGameplayCamera&&gameplayOpened&&!playerEliminated){baseShutdownRestartGameplayCamera=false;try{await startGameplayCamera();}catch(e){console.warn(e);}}else baseShutdownRestartGameplayCamera=false;
}
async function finishBaseShutdown(payload){
  if(!player||!match||baseShutdownBusy)return;
  baseShutdownBusy=true;
  try {
    // Validasi server dan kirim event agar seluruh pemain tim bertahan mendapat notifikasi.
    await api(`/api/matches/${match.id}/base-shutdown/start`,{method:'POST',body:JSON.stringify({player_id:player.id,qr_payload:payload})});
  } catch(error) {
    baseShutdownBusy=false;
    setBaseShutdownStatus(error.message || 'Tidak dapat memulai Base Shutdown.', true);
    return;
  }
  baseShutdownInProgress=true;
  const countdown=$('baseShutdownCountdown');let remaining=10;countdown?.classList.remove('hidden');if(countdown)countdown.textContent=String(remaining);
  setBaseShutdownStatus('QR valid. Pertahankan posisi sampai proses shutdown selesai.');
  const button=$('cancelBaseShutdownBtn');if(button)button.textContent='BATALKAN PROSES';
  baseShutdownTimer=setInterval(async()=>{remaining--;if(countdown)countdown.textContent=String(remaining);if(remaining<=0){clearInterval(baseShutdownTimer);baseShutdownTimer=null;try{
    const result=await api(`/api/matches/${match.id}/base-shutdown/complete`,{method:'POST',body:JSON.stringify({player_id:player.id,qr_payload:payload})});
    setBaseShutdownStatus(result.message||'Base lawan berhasil dinonaktifkan.');if(countdown)countdown.textContent='SUCCESS';
    const status=$('gameplayStatus');if(status)status.textContent=`${result.winner_team_code} WIN`;
    const shoot=$('shootBtn');if(shoot)shoot.disabled=true;
    setTimeout(()=>stopBaseShutdownScanner(false),2500);
  }catch(error){setBaseShutdownStatus(error.message||'Shutdown gagal.',true);baseShutdownInProgress=false;setTimeout(()=>stopBaseShutdownScanner(true),1800);}finally{baseShutdownBusy=false;}}},1000);
}
async function processBaseShutdownPayload(payload){
  if(!player||!match||baseShutdownBusy)return;const clean=String(payload||'').trim();
  if(!clean.startsWith('OPS-BASE-SHUTDOWN:')){setBaseShutdownStatus('QR bukan QR Base Shutdown.',true);return;}
  const code=clean.slice('OPS-BASE-SHUTDOWN:'.length).trim();if(!['BASE-RED','BASE-BLUE'].includes(code)){setBaseShutdownStatus('Kode base tidak valid.',true);return;}
  // Backend performs the authoritative team/match validation after the countdown.
  if(baseShutdownScanner){const sc=baseShutdownScanner;baseShutdownScanner=null;try{await sc.stop();}catch(_){}try{sc.clear();}catch(_){}}
  await finishBaseShutdown(clean);
}
async function startBaseShutdownScanner(){
  if(!gameplayOpened||!player||!match||playerEliminated||baseShutdownBusy)return;
  if(typeof Html5Qrcode==='undefined'){setBaseShutdownStatus('Library QR scanner gagal dimuat.',true);return;}
  $('baseShutdownModal')?.classList.remove('hidden');setBaseShutdownStatus('Meminta izin kamera...');
  baseShutdownRestartGameplayCamera=!!cameraStream;if(cameraStream)stopGameplayCamera();
  try{baseShutdownScanner=new Html5Qrcode('baseShutdownReader',{verbose:false,formatsToSupport:[Html5QrcodeSupportedFormats.QR_CODE]});await baseShutdownScanner.start({facingMode:'environment'},{fps:10,qrbox:(w,h)=>{const n=Math.max(160,Math.min(260,Math.floor(Math.min(w,h)*.72)));return{width:n,height:n};},aspectRatio:1},async text=>{if(!baseShutdownBusy)await processBaseShutdownPayload(text);},()=>{});setBaseShutdownStatus('Kamera aktif. Scan QR Base milik tim lawan.');}catch(e){setBaseShutdownStatus('Kamera tidak dapat dibuka. Gunakan gambar QR dari galeri.',true);}
}
async function scanBaseShutdownImage(file){if(!file||typeof Html5Qrcode==='undefined')return;const scanner=new Html5Qrcode('baseShutdownReader',{verbose:false});try{const decoded=await scanner.scanFile(file,true);await processBaseShutdownPayload(decoded);}catch(e){setBaseShutdownStatus('QR tidak terbaca. Coba gambar yang lebih jelas.',true);}finally{try{scanner.clear();}catch(_){}$('baseShutdownFile').value='';}}

// GAMEPLAY CAMERA CONTROLS
// ==========================================

const gameplayActionsToggle = $('toggleGameplayActions');
const gameplayActionBar = $('gameplayActionBar');
if (gameplayActionsToggle && gameplayActionBar) {
    gameplayActionsToggle.addEventListener('click', () => {
        const isExpanded = gameplayActionsToggle.getAttribute('aria-expanded') === 'true';
        const nextExpanded = !isExpanded;
        gameplayActionBar.classList.toggle('hidden', !nextExpanded);
        gameplayActionsToggle.setAttribute('aria-expanded', String(nextExpanded));
        const indicator = gameplayActionsToggle.querySelector('.actions-toggle-indicator');
        if (indicator) indicator.textContent = nextExpanded ? '+' : '+';
    });
}

$('enableCameraBtn').addEventListener(
    'click',
    startGameplayCamera
);

$('shootBtn').addEventListener(
    'click',
    sendShootEvent
);

$('scanWeaponQrBtn').addEventListener('click', startWeaponQrScanner);
$('scanBaseShutdownBtn').addEventListener('click', startBaseShutdownScanner);
$('closeBaseDefenseNotification').addEventListener('click', () => $('baseDefenseNotification')?.classList.remove('visible'));
$('closeBaseShutdownBtn').addEventListener('click', () => stopBaseShutdownScanner(true));
$('cancelBaseShutdownBtn').addEventListener('click', () => { if(baseShutdownTimer){clearInterval(baseShutdownTimer);baseShutdownTimer=null;} baseShutdownBusy=false;baseShutdownInProgress=false;setBaseShutdownStatus('Proses shutdown dibatalkan.',true);stopBaseShutdownScanner(true); });
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

// ==========================================
// GAMEPLAY LOGOUT
// ==========================================

$('gameplayLogoutBtn').addEventListener('click', async () => {
    await stopGhostQrScanner(false);
    if (ghostModeTickHandle) clearInterval(ghostModeTickHandle);
    ghostModeTickHandle = null;
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
        stopBaseShutdownNotificationPolling();

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

        // Kembali ke Main Menu / Room Browser setelah berhasil leave.
        $('lobbyPanel').classList.add('hidden');
        $('teamPanel').classList.add('hidden');
        $('roomPanel').classList.remove('hidden');

        // Lepaskan konteks room dan tim sebelumnya.
        match = null;
        window.currentPlayerTeam = null;

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

// ==========================================
// RESET PLAYER PORTAL
// ==========================================

function resetPortal(message) {
    if (pollHandle) {
        clearInterval(pollHandle);
    }

    stopGameplayCamera();
    stopGameplayHealthPolling();
    stopWeaponQrScanner();
    stopBaseShutdownNotificationPolling();

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
                setHint('registerHint', 'Kamera belum siap! Pastikan webcam aktif dan wajah Anda menghadap kamera.', true);
                return;
            }

            regBtn.disabled = true;
            setHint('registerHint', 'Mengekstrak biometrik wajah & mendaftarkan akun...');

            try {
                const result = await api('/api/players/register', {
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

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupFaceAuthEvents);
} else {
    setupFaceAuthEvents();
}
