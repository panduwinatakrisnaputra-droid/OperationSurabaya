
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
// PASSWORD VISIBILITY
// ==========================================

function togglePassword(inputId, button) {
    const input = $(inputId);

    const isPassword = input.type === 'password';

    input.type = isPassword ? 'text' : 'password';
    button.textContent = isPassword ? 'HIDE' : 'SHOW';
}

$('toggleLoginPassword').addEventListener('click', event => {
    togglePassword('loginPassword', event.currentTarget);
});

$('toggleRegisterPassword').addEventListener('click', event => {
    togglePassword('registerPassword', event.currentTarget);
});

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
// LOGIN
// ==========================================

$('loginBtn').addEventListener('click', async () => {
    const email = $('loginEmail').value.trim();
    const password = $('loginPassword').value;

    if (!email || !password) {
        setHint(
            'loginHint',
            'Email dan password wajib diisi.',
            true
        );

        return;
    }

    $('loginBtn').disabled = true;

    setHint('loginHint', 'Memverifikasi akun...');

    try {
        const result = await api('/api/players/login', {
            method: 'POST',
            body: JSON.stringify({
                email,
                password
            })
        });

        if (!result.access_token) {
            throw new Error(
                'Backend tidak mengembalikan access token.'
            );
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

// ==========================================
// REGISTER
// ==========================================

$('registerBtn').addEventListener('click', async () => {
    const username = $('playerName').value.trim();
    const full_name = $('fullName').value.trim();
    const email = $('playerEmail').value.trim();
    const password = $('registerPassword').value;

    if (!username || !full_name || !email || !password) {
        setHint(
            'registerHint',
            'Semua kolom wajib diisi.',
            true
        );

        return;
    }

    if (password.length < 8) {
        setHint(
            'registerHint',
            'Password minimal 8 karakter.',
            true
        );

        return;
    }

    $('registerBtn').disabled = true;

    setHint('registerHint', 'Membuat akun pemain...');

    try {
        const result = await api('/api/players/register', {
            method: 'POST',
            body: JSON.stringify({
                username,
                full_name,
                email,
                password
            })
        });

        if (result.access_token) {
            saveToken(result.access_token);

            await continueToTeam(getPlayer(result));

        } else {
            $('loginEmail').value = email;
            $('loginPassword').value = '';
            $('registerPassword').value = '';

            showAuth('login');

            setHint(
                'loginHint',
                'Registrasi berhasil. Silakan login menggunakan email dan password.'
            );
        }

    } catch (error) {
        setHint('registerHint', error.message, true);

    } finally {
        $('registerBtn').disabled = false;
    }
});

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

    $('loginEmail').value = '';
    $('loginPassword').value = '';

    $('playerName').value = '';
    $('fullName').value = '';
    $('playerEmail').value = '';
    $('registerPassword').value = '';

    $('operationStatus').textContent = 'STANDBY';

    showAuth('login');

    setHint('loginHint', message);
}

// ==========================================
// INITIALIZATION
// ==========================================

showAuth('login');

console.log('OPERATION: SURABAYA Player Portal initialized.');
